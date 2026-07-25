import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import process from 'node:process';

import { Command, CommanderError, Option } from 'commander';
import cliPackageJson from '../package.json';

import { listExtractionPresets } from '../../../src/lib/templates';
import {
  PROVIDER_IDS,
  PROVIDER_PROFILES,
  isLocalBaseUrl,
  providerDefaultApiKeyEnv,
  type ProviderId,
} from '../../../src/lib/providers';
import {
  cliConfigDisabled,
  credentialSetupGuidance,
  loadCliConfig,
  loadLocalEnv,
  resolveCliOptions,
} from './config';
import {
  asCliExitError,
  CliExitError,
  cliBatchExitCode,
  cliExitCode,
  cliRunStatusExitCode,
  cliSignalExitCode,
  ocrErrorPayload,
  type CliExitCode,
} from './errors';
import { discoverInputs } from './inputs';
import { runInit, validateProviderCredentials, type InitFlags } from './init';
import { promptInteractiveArguments } from './interactive';
import { primaryArtifact } from './output';
import { loadCustomSchema } from './schema';
import { executeOcrJobRequest, readOcrJobRequestRaw } from './machine';
import {
  assertOcrJobEvent,
  createOcrCapabilities,
  errorPayloadForProtocol,
  OCR_PROTOCOL_SCHEMAS,
  OCR_PROTOCOL_VERSION,
  parseOcrJobRequest,
  toOcrRunFailure,
  type OcrJobEvent,
} from './protocol';
import { runBatch } from './runner';
import { providerRuntimeConfig } from './providerRuntime';
import { inspectBatchStatus, renderBatchStatus } from './status';
import type { ExtractCommandFlags } from './types';
import {
  assertWebOutputAvailable,
  resolveWebUrls,
  runWebJob,
  WEB_ANALYSIS_MODES,
  type WebAnalysisMode,
  type WebOutputFormat,
} from './web';

export const PRIMARY_CLI_NAME = 'open-ocr-cli';
const CLI_BINARY_NAMES = new Set([PRIMARY_CLI_NAME, 'gemini-ocr']);

export function cliBinaryName(argv: string[] = process.argv): string {
  const invoked = path.basename(argv[1] ?? '');
  return CLI_BINARY_NAMES.has(invoked) ? invoked : PRIMARY_CLI_NAME;
}

export function cliVersion(): string {
  const version: unknown = cliPackageJson.version;
  if (typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    return version;
  }
  throw new Error(
    'Unable to determine the CLI version: packages/cli/package.json has no valid version.',
  );
}

function isSupportedNode(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return (major === 20 && minor >= 19)
    || (major === 22 && minor >= 13)
    || major >= 24;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function writeMachineStdout(value: string): Promise<void> {
  if (process.stdout.write(value)) return;
  await once(process.stdout, 'drain');
}

interface InterruptRuntime {
  abortController: AbortController;
  interruptedExitCode: () => CliExitCode | undefined;
}

async function withInterruptHandling<T>(
  operation: (runtime: InterruptRuntime) => Promise<T>,
): Promise<T> {
  const abortController = new AbortController();
  let exitCode: CliExitCode | undefined;
  const interrupt = (signal: 'SIGINT' | 'SIGTERM'): void => {
    exitCode = cliSignalExitCode(signal);
    abortController.abort(new Error(`Interrupted by ${signal}`));
  };
  const onSigint = (): void => interrupt('SIGINT');
  const onSigterm = (): void => interrupt('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  try {
    return await operation({ abortController, interruptedExitCode: () => exitCode });
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

function assertConfigFlagsDoNotConflict(command: Command): void {
  const rawArgs = (command.parent as (Command & { rawArgs?: string[] }) | null)?.rawArgs ?? [];
  const hasConfigPath = rawArgs.some((argument: string) => argument === '--config' || argument.startsWith('--config='));
  const hasNoConfig = rawArgs.includes('--no-config');
  if (hasConfigPath && hasNoConfig) {
    throw new CliExitError('--config and --no-config are mutually exclusive', 2, {
      code: 'CONFIG_INVALID',
      category: 'configuration',
      retryable: false,
      hint: 'Choose either an explicit configuration file or a hermetic run.',
    });
  }
}

function addProviderOptions(command: Command): Command {
  return command
    .addOption(new Option('--provider <provider>', 'model provider').choices([...PROVIDER_IDS]))
    .addOption(new Option('--gateway <gateway>', 'API route').choices(['direct', 'cloudflare']))
    .option('--model <model>', 'provider model identifier')
    .option('--base-url <url>', 'override the provider-compatible API base URL')
    .option('--api-key-env <name>', 'environment variable containing the provider API key')
    .option('--cloudflare-account-id <id>', 'Cloudflare account ID for AI Gateway')
    .option('--cloudflare-gateway-id <id>', 'Cloudflare AI Gateway ID')
    .option('--cloudflare-token-env <name>', 'environment variable containing the AI Gateway token')
    .option('--cloudflare-byok', 'use a provider key stored in Cloudflare AI Gateway')
    .option('--cloudflare-byok-alias <alias>', 'Cloudflare stored-key alias')
    .option('--cloudflare-provider <slug>', 'Cloudflare custom-provider slug for Kimi, Muse, or compatible APIs')
    .option('--input-price <usd>', 'custom input price per million tokens (requires --output-price)')
    .option('--output-price <usd>', 'custom output price per million tokens (requires --input-price)');
}

function addExtractOptions(command: Command): Command {
  return addProviderOptions(command)
    .argument('<inputs...>', 'files, directories, globs, or - for stdin')
    .option('--config <path>', 'explicit JSON configuration file')
    .option('--no-config', 'ignore config files and .env for a hermetic run')
    .addOption(new Option('--mode <mode>', 'OCR mode').choices(['simple', 'template', 'agentic']))
    .option('--preset <id>', 'structured extraction preset (implies template mode)')
    .option('--schema <path>', 'JSON Schema for custom structured extraction')
    .addOption(new Option('--format <format>', 'artifact format').choices(['markdown', 'json', 'csv', 'all']))
    .option('-o, --output <path>', 'output file for one document or directory for batches')
    .addOption(new Option('--thinking <level>', 'thinking/reasoning effort').choices(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']))
    .addOption(new Option('--progress <level>', 'agent progress detail').choices(['off', 'standard', 'detailed']))
    .option('--include-thoughts', 'deprecated alias for --progress standard')
    .option('-c, --concurrency <count>', 'parallel documents (1-16)')
    .option('--retries <count>', 'transient retries per document (0-10)')
    .option('--timeout <seconds>', 'per-document time limit')
    .option('--max-files <count>', 'safety limit for matched documents')
    .option('--max-total-mb <megabytes>', 'safety limit for total input size')
    .option('--max-cost <usd>', 'block new requests and documents after estimated paid-tier cost reaches this value')
    .option('--requests-per-minute <count>', 'maximum provider API request starts per minute (0 disables)')
    .option('--exclude <glob>', 'exclude pattern; repeatable', collect, [])
    .option('--instruction <text>', 'custom extraction instruction; repeatable', collect, [])
    .option('--hidden', 'include hidden files when expanding directories and globs')
    .option('--resume', 'skip unchanged documents recorded in the batch manifest')
    .option('--no-resume', 'process documents even when the manifest marks them complete')
    .option('--overwrite', 'replace existing output artifacts')
    .option('--force-unlock', 'recover a same-host batch lock only when its owner process is dead')
    .option('--fail-fast', 'stop scheduling new documents after the first failure')
    .option('--jsonl', 'emit the established inline document JSONL stream on stdout')
    .option('--dry-run', 'resolve and validate the job without calling a provider or writing files')
    .option('--quiet', 'suppress progress output on stderr')
    .option('--verbose', 'show agent steps and detailed progress on stderr')
    .option('--stdin-name <name>', 'filename used for stdin input (type is sniffed when omitted)')
    .option('--stdin-type <mime>', 'MIME type for stdin when it cannot be inferred from --stdin-name')
    .option('--detect-images', 'describe charts, diagrams, and non-text images in simple mode')
    .option('--detect-math', 'detect and format equations in simple mode')
    .option('--max-tokens <count>', 'maximum generated tokens per model response')
    .option('--max-iterations <count>', 'maximum outer iterations in agentic mode')
    .option('--confidence-threshold <number>', 'agentic completion threshold from 0 to 1');
}

export function createProgram(binaryName = PRIMARY_CLI_NAME): Command {
  const commandName = CLI_BINARY_NAMES.has(binaryName) ? binaryName : PRIMARY_CLI_NAME;
  const program = new Command()
    .name(commandName)
    .description('Provider-neutral multimodal OCR for files, URLs, and document pipelines')
    .version(cliVersion())
    .exitOverride()
    .showHelpAfterError()
    .addHelpText('after', `
Examples:
  $ ${commandName}                       # print help; never prompts
  $ ${commandName} interactive           # explicitly launch the command menu
  $ ${commandName} init
  $ ${commandName} extract invoice.pdf
  $ ${commandName} extract invoice.pdf --provider kimi --model kimi-k3
  $ ${commandName} extract invoice.pdf --provider openrouter --model moonshotai/kimi-k3
  $ ${commandName} extract invoice.pdf --provider gemini --gateway cloudflare
  $ ${commandName} extract invoice.pdf --schema invoice.schema.json
  $ ${commandName} extract ./documents --mode template --preset invoice --format all
  $ ${commandName} extract '**/*.pdf' --concurrency 4 --max-cost 5 --output ./results
  $ ${commandName} capabilities --json
  $ ${commandName} run --request ocr-request.json --response-format jsonl
  $ ${commandName} mcp                    # stdio MCP server
  $ cat scan.png | ${commandName} extract - --stdin-name scan.png --format json
  $ ${commandName} web https://example.com/report.pdf --format markdown
  $ ${commandName} status ./results
  $ ${commandName} presets

Environment:
  GEMINI_API_KEY / MOONSHOT_API_KEY / META_API_KEY / OPENROUTER_API_KEY
  OPEN_OCR_PROVIDER       Default provider override
  OPEN_OCR_MODEL          Default model override
  OPEN_OCR_THINKING       Default thinking level override
  OPEN_OCR_NO_CONFIG      Set to 1 for a hermetic run without config files or .env
  CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_GATEWAY_ID / CLOUDFLARE_AI_GATEWAY_TOKEN

Configuration is loaded from the legacy Gemini paths, then
~/.config/open-ocr-cli/config.json, ./.open-ocr-cli.json, and --config.
CLI flags take precedence.
`);

  program.command('interactive')
    .alias('i')
    .description('launch the guided command menu')
    .action(async () => {
      if (!process.stdin.isTTY || !process.stderr.isTTY) {
        throw asCliExitError(new Error('Interactive mode requires a terminal (TTY)'), 2);
      }
      const selectedArguments = await promptInteractiveArguments();
      if (!selectedArguments) return;
      await createProgram(commandName).parseAsync(['node', commandName, ...selectedArguments]);
    });

  addExtractOptions(program.command('extract').description('extract one or many documents'))
    .action(async (inputs: string[], flags: ExtractCommandFlags, command: Command) => {
      try {
        assertConfigFlagsDoNotConflict(command);
        const cwd = process.cwd();
        const noConfig = cliConfigDisabled(flags.config);
        loadLocalEnv(cwd, noConfig);
        const fileConfig = await loadCliConfig(
          cwd,
          typeof flags.config === 'string' ? flags.config : undefined,
          noConfig,
        );
        // A malformed schema is a local request error and must be reported
        // before credential resolution can fail or any provider work begins.
        const schemaPath = flags.schema ?? fileConfig.schema;
        const customSchema = schemaPath
          ? await loadCustomSchema(schemaPath, cwd)
          : undefined;
        const resolvedOptions = resolveCliOptions(flags, fileConfig, cwd);
        const options = customSchema
          ? { ...resolvedOptions, customSchema }
          : resolvedOptions;
        const resolvedInputs = await discoverInputs(inputs, options);
        await withInterruptHandling(async ({ abortController, interruptedExitCode }) => {
          try {
            if (!options.quiet) {
              process.stderr.write(
                `${options.dryRun ? 'Planning' : 'Processing'} ${resolvedInputs.length} document(s) `
                + `with ${options.provider}/${options.model} via ${options.gateway} in ${options.mode} mode `
                + `(concurrency ${options.concurrency})\n`,
              );
            }
            const summary = await runBatch(resolvedInputs, options, {
              abortController,
            });
            if (!options.quiet) {
              process.stderr.write(
                `Finished: ${summary.succeeded} succeeded, ${summary.partial} partial, ${summary.failed} failed, ${summary.skipped} skipped; `
                + `${summary.usage.totalTokens} tokens across ${summary.usage.requests} request(s); `
                + `estimated cost $${summary.usage.estimatedCostUsd.toFixed(6)}\n`,
              );
            }
            if (abortController.signal.aborted) process.exitCode = interruptedExitCode() ?? 1;
            else {
              const exitCode = cliBatchExitCode(summary);
              if (exitCode !== 0) process.exitCode = exitCode;
            }
          } catch (error) {
            const signalExitCode = interruptedExitCode();
            if (signalExitCode !== undefined) {
              process.exitCode = signalExitCode;
              return;
            }
            throw asCliExitError(error, 1);
          }
        });
      } catch (error) {
        const typed = asCliExitError(error, 2);
        throw typed;
      }
    });

  program.command('run')
    .description('execute a versioned OCR request for coding agents and automation')
    .requiredOption('--request <path>', 'request JSON file, or - to read the request from stdin')
    .addOption(new Option('--response-format <format>', 'machine response format').choices(['json', 'jsonl']).default('json'))
    .option('--no-config', 'ignore config files and .env for a hermetic run')
    .action(async (flags: { request: string; responseFormat: 'json' | 'jsonl'; config?: boolean }) => {
      const runId = randomUUID();
      let protocolVersion: 1 | 2 = OCR_PROTOCOL_VERSION;
      let lastSequence = -1;
      let emittedFailure = false;
      const eventSink = flags.responseFormat === 'jsonl'
        ? async (event: OcrJobEvent): Promise<void> => {
            lastSequence = event.sequence;
            if (event.type === 'run.failed') emittedFailure = true;
            await writeMachineStdout(`${JSON.stringify(event)}\n`);
          }
        : undefined;
      await withInterruptHandling(async ({ abortController, interruptedExitCode }) => {
        try {
          const loaded = await readOcrJobRequestRaw(
            flags.request,
            process.cwd(),
            abortController.signal,
          );
          // Peek before full validation so invalid v1 bodies still fail as v1.
          if (loaded.declaredProtocolVersion) protocolVersion = loaded.declaredProtocolVersion;
          const request = parseOcrJobRequest(loaded.parsed);
          protocolVersion = request.protocolVersion;
          if (flags.request === '-' && request.inputs.some((input) => (
            input.type === 'stdin' || (input.type === 'path' && input.path === '-')
          ))) {
            throw new CliExitError(
              'Request JSON and document bytes cannot both be read from stdin; store the request in a file.',
              2,
              {
                code: 'CONFIG_INVALID',
                category: 'configuration',
                retryable: false,
                hint: 'Pass --request <file> when the OCR document uses stdin.',
              },
            );
          }
          const execution = await executeOcrJobRequest(request, {
            cwd: process.cwd(),
            runId,
            abortController,
            eventSink,
            onWarning: (message) => process.stderr.write(`${message}\n`),
            noConfig: flags.config === false,
          });
          if (flags.responseFormat === 'json') {
            await writeMachineStdout(`${JSON.stringify(execution.result)}\n`);
          }
          if (abortController.signal.aborted) process.exitCode = interruptedExitCode() ?? 1;
          else {
            const exitCode = cliRunStatusExitCode(execution.result.status);
            if (exitCode !== 0) process.exitCode = exitCode;
          }
        } catch (error) {
          const signalExitCode = interruptedExitCode();
          const payload = ocrErrorPayload(error, signalExitCode ?? 2);
          if (flags.responseFormat === 'json') {
            await writeMachineStdout(`${JSON.stringify(toOcrRunFailure(runId, payload, protocolVersion))}\n`);
          } else if (!emittedFailure) {
            const event: OcrJobEvent = {
              protocolVersion,
              type: 'run.failed',
              runId,
              sequence: lastSequence + 1,
              timestamp: new Date().toISOString(),
              error: errorPayloadForProtocol(payload, protocolVersion),
            };
            assertOcrJobEvent(event);
            await writeMachineStdout(`${JSON.stringify(event)}\n`);
          }
          process.exitCode = signalExitCode ?? cliExitCode(asCliExitError(error, 2));
        }
      });
    });

  program.command('capabilities')
    .description('describe the stable machine protocol, providers, presets, and limits')
    .option('--json', 'emit the complete machine-readable capability document')
    .action((flags: { json?: boolean }) => {
      const capabilities = createOcrCapabilities(cliVersion());
      if (flags.json) process.stdout.write(`${JSON.stringify(capabilities, null, 2)}\n`);
      else process.stdout.write(
        `Protocol v${capabilities.protocolVersion}: ${capabilities.operations.join(', ')}; `
        + `modes ${capabilities.modes.join(', ')}; use --json for the full contract.\n`,
      );
    });

  program.command('schema')
    .description('print one bundled machine-protocol JSON Schema')
    .argument('<name>', 'request/result/event/error/capabilities, optionally suffixed with -v1 or -v2')
    .action((name: string) => {
      if (!(name in OCR_PROTOCOL_SCHEMAS)) {
        throw new Error(`Unknown protocol schema: ${name}`);
      }
      const schema = OCR_PROTOCOL_SCHEMAS[name as keyof typeof OCR_PROTOCOL_SCHEMAS];
      process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
    });

  program.command('mcp')
    .description('serve OCR tools over the Model Context Protocol stdio transport')
    .action(async () => {
      const { runMcpServer } = await import('./mcp');
      await runMcpServer(cliVersion());
    });

  program.command('init')
    .description('interactively create a safe CLI configuration and validate credentials')
    .option('--global', 'write the user configuration instead of ./.open-ocr-cli.json')
    .addOption(new Option('--provider <provider>', 'model provider').choices([...PROVIDER_IDS]))
    .addOption(new Option('--gateway <gateway>', 'API route').choices(['direct', 'cloudflare']))
    .option('--model <model>', 'provider model identifier (required for openai-compatible with --yes)')
    .option('--force', 'replace an existing configuration without confirmation')
    .option('--yes', 'accept recommended defaults without prompting')
    .option('--skip-validation', 'do not make the credential validation request')
    .action(async (flags: InitFlags) => {
      loadLocalEnv(process.cwd());
      await runInit(flags);
    });

  addProviderOptions(program.command('web'))
    .description('extract grounded content from public URLs')
    .argument('[urls...]', 'up to 20 public HTTP(S) URLs')
    .option('--file <path>', 'read URLs from a text file, one per line')
    .option('--config <path>', 'explicit JSON configuration file')
    .option('--no-config', 'ignore config files and .env for a hermetic run')
    .addOption(new Option('--analysis <mode>', 'URL analysis mode').choices([...WEB_ANALYSIS_MODES]).default('individual'))
    .addOption(new Option('--format <format>', 'output format').choices(['markdown', 'json']))
    .option('-o, --output <path>', 'write output to a file instead of stdout')
    .addOption(new Option('--thinking <level>', 'thinking/reasoning effort').choices(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']))
    .option('--include-thoughts', 'deprecated compatibility flag; Web OCR does not emit reasoning progress')
    .option('--timeout <seconds>', 'request time limit')
    .option('--max-cost <usd>', 'fail if estimated paid-tier cost reaches this value')
    .option('--requests-per-minute <count>', 'maximum provider API request starts per minute (0 disables)')
    .option('--overwrite', 'replace an existing output file')
    .option('--dry-run', 'validate URLs and configuration without calling a provider')
    .option('--quiet', 'suppress status output on stderr')
    .action(async (rawUrls: string[], flags: ExtractCommandFlags & {
      file?: string;
      analysis: WebAnalysisMode;
      format?: WebOutputFormat;
      output?: string;
    }, command: Command) => {
      assertConfigFlagsDoNotConflict(command);
      const cwd = process.cwd();
      const noConfig = cliConfigDisabled(flags.config);
      loadLocalEnv(cwd, noConfig);
      const fileConfig = await loadCliConfig(
        cwd,
        typeof flags.config === 'string' ? flags.config : undefined,
        noConfig,
      );
      const options = resolveCliOptions(
        flags,
        { ...fileConfig, mode: 'simple', preset: undefined, schema: undefined },
        cwd,
      );
      if (options.format !== 'markdown' && options.format !== 'json') {
        throw new Error('Web OCR format must be markdown or json');
      }
      const webFormat: WebOutputFormat = options.format;
      const urls = await resolveWebUrls(rawUrls, flags.file, cwd);
      const outputTarget = options.output
        ? await assertWebOutputAvailable(options.output, cwd, options.overwrite)
        : undefined;
      await withInterruptHandling(async ({ abortController, interruptedExitCode }) => {
        try {
          const execution = await runWebJob(
            urls,
            flags.analysis,
            options,
            { runId: randomUUID(), abortController },
          );
          const result = execution.summary.results[0];
          if (!result) throw new Error('Web OCR completed without a result');
          if (result.status === 'failed') {
            const details = result.errorDetails;
            throw new CliExitError(result.error ?? 'Web OCR did not complete', 1, {
              code: details?.code,
              category: details?.category,
              retryable: details?.retryable,
              hint: details?.hint,
            });
          }
          if (options.dryRun) {
            process.stdout.write(`${JSON.stringify({ valid: true, urls, output: outputTarget }, null, 2)}\n`);
            return;
          }
          if (result.status !== 'succeeded') {
            const details = result.errorDetails;
            throw new CliExitError(result.error ?? 'Web OCR did not complete', 1, {
              code: details?.code,
              category: details?.category,
              retryable: details?.retryable,
              hint: details?.hint,
            });
          }
          if (!options.output) {
            if (!result.artifacts) throw new Error('Web OCR returned no inline artifacts');
            await writeMachineStdout(primaryArtifact(result.artifacts, webFormat));
          }
          const usage = execution.summary.usage;
          if (!options.quiet) process.stderr.write(
            `Extracted ${urls.length} URL(s); ${usage.totalTokens} tokens across ${usage.requests} request(s); `
            + `estimated cost $${usage.estimatedCostUsd.toFixed(6)}\n`,
          );
          const exitCode = cliBatchExitCode(execution.summary);
          if (exitCode !== 0) process.exitCode = exitCode;
        } catch (error) {
          const signalExitCode = interruptedExitCode();
          if (signalExitCode !== undefined) {
            process.exitCode = signalExitCode;
            return;
          }
          if (abortController.signal.aborted && abortController.signal.reason instanceof Error) {
            throw asCliExitError(abortController.signal.reason, 1);
          }
          throw asCliExitError(error, 1);
        }
      });
    });

  program.command('presets')
    .description('list available structured extraction presets')
    .option('--json', 'emit machine-readable JSON')
    .action((flags: { json?: boolean }) => {
      const presets = listExtractionPresets();
      if (flags.json) {
        process.stdout.write(`${JSON.stringify(presets, null, 2)}\n`);
        return;
      }
      for (const preset of presets) {
        process.stdout.write(`${preset.id.padEnd(16)} ${preset.label} — ${preset.description}\n`);
      }
    });

  program.command('models')
    .description('list recommended models for a provider; arbitrary IDs are accepted where supported')
    .addOption(new Option('--provider <provider>', 'model provider').choices([...PROVIDER_IDS]).default('gemini'))
    .option('--json', 'emit machine-readable JSON')
    .action((flags: { provider: ProviderId; json?: boolean }) => {
      const profile = PROVIDER_PROFILES[flags.provider];
      if (flags.json) process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
      else if (profile.models.length === 0) process.stdout.write('No fixed model list; pass the upstream model ID with --model.\n');
      else for (const model of profile.models) process.stdout.write(`${model}\n`);
    });

  program.command('providers')
    .description('list provider profiles and multimodal capabilities')
    .option('--json', 'emit machine-readable JSON')
    .action((flags: { json?: boolean }) => {
      const profiles = Object.values(PROVIDER_PROFILES);
      if (flags.json) process.stdout.write(`${JSON.stringify(profiles, null, 2)}\n`);
      else for (const profile of profiles) {
        process.stdout.write(`${profile.id.padEnd(20)} ${profile.label} — default ${profile.defaultModel ?? 'model required'}\n`);
      }
    });

  program.command('doctor')
    .description('check local CLI configuration and optionally probe provider credentials')
    .option('--config <path>', 'explicit JSON configuration file')
    .option('--no-config', 'ignore config files and .env for a hermetic diagnosis')
    .option('--check-credentials', 'make a minimal provider request to validate endpoint access')
    .option('--json', 'emit machine-readable JSON')
    .action(async (flags: {
      config?: string | false;
      checkCredentials?: boolean;
      json?: boolean;
    }, command: Command) => {
      assertConfigFlagsDoNotConflict(command);
      const cwd = process.cwd();
      const noConfig = cliConfigDisabled(flags.config);
      loadLocalEnv(cwd, noConfig);
      const config = await loadCliConfig(
        cwd,
        typeof flags.config === 'string' ? flags.config : undefined,
        noConfig,
      );
      let resolvedConfig: ReturnType<typeof resolveCliOptions> | undefined;
      let configurationError: string | undefined;
      try {
        resolvedConfig = resolveCliOptions({ dryRun: true }, config, cwd);
      } catch (error) {
        configurationError = error instanceof Error ? error.message : String(error);
      }
      const configuredProvider = config.provider && PROVIDER_IDS.includes(config.provider)
        ? config.provider
        : 'gemini';
      const provider = resolvedConfig?.provider ?? configuredProvider;
      const apiKeyEnv = resolvedConfig?.apiKeyEnv ?? config.apiKeyEnv ?? providerDefaultApiKeyEnv(provider);
      const gatewayTokenEnv = config.cloudflareTokenEnv || 'CLOUDFLARE_AI_GATEWAY_TOKEN';
      const providerKeyOptional = Boolean(resolvedConfig?.cloudflareByok)
        || (provider === 'openai-compatible' && Boolean(
          resolvedConfig?.baseUrl && isLocalBaseUrl(resolvedConfig.baseUrl),
        ));
      const gatewayTokenRequired = resolvedConfig?.gateway === 'cloudflare'
        && resolvedConfig.cloudflareByok;
      const gatewayTokenConfigured = Boolean(process.env[gatewayTokenEnv]);
      let credentialProbe: {
        status: 'not_requested' | 'passed' | 'failed' | 'skipped';
        error?: string;
      } = { status: 'not_requested' };
      if (flags.checkCredentials) {
        if (!resolvedConfig || configurationError) {
          credentialProbe = { status: 'skipped', error: 'Configuration is invalid.' };
        } else if (!providerKeyOptional && !process.env[apiKeyEnv]) {
          credentialProbe = { status: 'skipped', error: `${apiKeyEnv} is not configured.` };
        } else if (gatewayTokenRequired && !gatewayTokenConfigured) {
          credentialProbe = { status: 'skipped', error: `${gatewayTokenEnv} is not configured.` };
        } else {
          try {
            await validateProviderCredentials(providerRuntimeConfig(resolvedConfig));
            credentialProbe = { status: 'passed' };
          } catch (error) {
            credentialProbe = {
              status: 'failed',
              error: asCliExitError(error, 1).message,
            };
          }
        }
      }
      const checks = {
        node: { ok: isSupportedNode(process.versions.node), version: process.versions.node },
        configuration: { ok: !configurationError, error: configurationError },
        provider,
        gateway: resolvedConfig?.gateway ?? config.gateway ?? 'direct',
        apiKey: { ok: providerKeyOptional || Boolean(process.env[apiKeyEnv]), environmentVariable: apiKeyEnv },
        gatewayToken: {
          ok: !gatewayTokenRequired || gatewayTokenConfigured,
          required: gatewayTokenRequired,
          configured: gatewayTokenConfigured,
          environmentVariable: gatewayTokenEnv,
        },
        credentialProbe,
        projectConfig: path.join(cwd, '.open-ocr-cli.json'),
        legacyProjectConfig: path.join(cwd, '.gemini-ocr.json'),
        effectiveConfig: config,
      };
      if (flags.json) process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
      else {
        process.stdout.write(`Node.js ${checks.node.version}: ${checks.node.ok ? 'ok' : 'use Node 20.19+, 22.13+, or 24+'}\n`);
        process.stdout.write(`Configuration: ${checks.configuration.ok ? 'ok' : checks.configuration.error}\n`);
        process.stdout.write(`${apiKeyEnv}: ${checks.apiKey.ok ? 'configured' : 'missing'}\n`);
        if (checks.gatewayToken.required) {
          process.stdout.write(`${gatewayTokenEnv}: ${checks.gatewayToken.ok ? 'configured' : 'missing'}\n`);
        }
        if (flags.checkCredentials) {
          process.stdout.write(
            `Credential probe: ${checks.credentialProbe.status}`
            + `${checks.credentialProbe.error ? ` — ${checks.credentialProbe.error}` : ''}\n`,
          );
        }
        process.stdout.write(`Project config: ${checks.projectConfig}\n`);
        if (!checks.apiKey.ok) process.stdout.write(`${credentialSetupGuidance(apiKeyEnv, cwd, provider)}\n`);
      }
      if (
        !checks.node.ok
        || !checks.configuration.ok
        || !checks.apiKey.ok
        || !checks.gatewayToken.ok
        || checks.credentialProbe.status === 'failed'
        || checks.credentialProbe.status === 'skipped'
      ) {
        process.exitCode = 1;
      }
    });

  program.command('status')
    .description('inspect a batch manifest, artifacts, failures, and usage')
    .argument('[output]', 'batch output directory', 'gemini-ocr-output')
    .option('--json', 'emit machine-readable JSON')
    .action(async (output: string, flags: { json?: boolean }) => {
      const report = await inspectBatchStatus(output, process.cwd());
      process.stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : renderBatchStatus(report));
      if (!report.healthy) process.exitCode = 1;
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram(cliBinaryName(argv));
  try {
    if (argv.length <= 2) {
      program.outputHelp();
      return;
    }
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander has already rendered parser errors and help. Preserve normal
      // help/version success while mapping usage errors to the CLI contract.
      if (error.exitCode !== 0) process.exitCode = 2;
      return;
    }
    throw error;
  }
}
