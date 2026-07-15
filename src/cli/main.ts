import path from 'node:path';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Command, CommanderError, Option } from 'commander';

import { listExtractionPresets } from '../lib/templates';
import {
  PROVIDER_IDS,
  PROVIDER_PROFILES,
  configureProviderRequestPolicy,
  getProviderUsage,
  isLocalBaseUrl,
  providerDefaultApiKeyEnv,
  resetProviderRequestPolicy,
  resetProviderUsage,
  type ProviderId,
} from '../lib/providers';
import { credentialSetupGuidance, loadCliConfig, loadLocalEnv, resolveCliOptions } from './config';
import { asCliExitError, cliSignalExitCode, type CliExitCode } from './errors';
import { discoverInputs } from './inputs';
import { runInit, type InitFlags } from './init';
import { promptInteractiveArguments } from './interactive';
import { loadCustomSchema } from './schema';
import { runBatch } from './runner';
import { inspectBatchStatus, renderBatchStatus } from './status';
import type { ExtractCommandFlags } from './types';
import {
  assertWebOutputAvailable,
  renderWebResult,
  resolveWebUrls,
  runWebExtraction,
  WEB_ANALYSIS_MODES,
  writeWebOutput,
  type WebAnalysisMode,
  type WebOutputFormat,
} from './web';

export const PRIMARY_CLI_NAME = 'open-ocr-cli';
const CLI_BINARY_NAMES = new Set([PRIMARY_CLI_NAME, 'gemini-ocr']);

export function cliBinaryName(argv: string[] = process.argv): string {
  const invoked = path.basename(argv[1] ?? '');
  return CLI_BINARY_NAMES.has(invoked) ? invoked : PRIMARY_CLI_NAME;
}

function cliVersion(): string {
  const candidates = [new URL('../package.json', import.meta.url), new URL('../../package.json', import.meta.url)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(fileURLToPath(candidate), 'utf8')) as { version?: unknown };
      if (typeof parsed.version === 'string') return parsed.version;
    } catch {
      // Try the source-tree fallback after the packaged layout.
    }
  }
  return '0.0.0';
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
    .addOption(new Option('--mode <mode>', 'OCR mode').choices(['simple', 'template', 'agentic']))
    .option('--preset <id>', 'structured extraction preset (implies template mode)')
    .option('--schema <path>', 'JSON Schema for custom structured extraction')
    .addOption(new Option('--format <format>', 'artifact format').choices(['markdown', 'json', 'csv', 'all']))
    .option('-o, --output <path>', 'output file for one document or directory for batches')
    .addOption(new Option('--thinking <level>', 'thinking level').choices(['minimal', 'low', 'medium', 'high']))
    .option('--include-thoughts', 'request thought summaries where supported')
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
    .option('--jsonl', 'emit one machine-readable event per document on stdout')
    .option('--dry-run', 'resolve and validate the job without calling a provider or writing files')
    .option('--quiet', 'suppress progress output on stderr')
    .option('--verbose', 'show agent steps and detailed progress on stderr')
    .option('--stdin-name <name>', 'filename used for stdin input', 'stdin.pdf')
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
  $ ${commandName}                       # guided interactive mode
  $ ${commandName} interactive           # explicitly launch the command menu
  $ ${commandName} init
  $ ${commandName} extract invoice.pdf
  $ ${commandName} extract invoice.pdf --provider kimi --model kimi-k2.6
  $ ${commandName} extract invoice.pdf --provider openrouter --model moonshotai/kimi-k2.6
  $ ${commandName} extract invoice.pdf --provider gemini --gateway cloudflare
  $ ${commandName} extract invoice.pdf --schema invoice.schema.json
  $ ${commandName} extract ./documents --mode template --preset invoice --format all
  $ ${commandName} extract '**/*.pdf' --concurrency 4 --max-cost 5 --output ./results
  $ cat scan.png | ${commandName} extract - --stdin-name scan.png --format json
  $ ${commandName} web https://example.com/report.pdf --format markdown
  $ ${commandName} status ./results
  $ ${commandName} presets

Environment:
  GEMINI_API_KEY / MOONSHOT_API_KEY / META_API_KEY / OPENROUTER_API_KEY
  OPEN_OCR_PROVIDER       Default provider override
  OPEN_OCR_MODEL          Default model override
  OPEN_OCR_THINKING       Default thinking level override
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
    .action(async (inputs: string[], flags: ExtractCommandFlags) => {
      const cwd = process.cwd();
      loadLocalEnv(cwd);
      const fileConfig = await loadCliConfig(cwd, flags.config);
      const resolvedOptions = resolveCliOptions(flags, fileConfig, cwd);
      const options = resolvedOptions.schemaPath
        ? { ...resolvedOptions, customSchema: await loadCustomSchema(resolvedOptions.schemaPath, cwd) }
        : resolvedOptions;
      const resolvedInputs = await discoverInputs(inputs, options);
      const abortController = new AbortController();
      let interruptedExitCode: CliExitCode | undefined;
      const interrupt = (exitCode: CliExitCode): void => {
        interruptedExitCode = exitCode;
        abortController.abort(new Error('Interrupted'));
      };
      const onSigint = (): void => interrupt(cliSignalExitCode('SIGINT'));
      const onSigterm = (): void => interrupt(cliSignalExitCode('SIGTERM'));
      process.once('SIGINT', onSigint);
      process.once('SIGTERM', onSigterm);
      try {
        if (!options.quiet) {
          process.stderr.write(
            `${options.dryRun ? 'Planning' : 'Processing'} ${resolvedInputs.length} document(s) `
            + `with ${options.provider}/${options.model} via ${options.gateway} in ${options.mode} mode `
            + `(concurrency ${options.concurrency})\n`,
          );
        }
        const summary = await runBatch(resolvedInputs, options, { abortController });
        if (!options.quiet) {
          process.stderr.write(
            `Finished: ${summary.succeeded} succeeded, ${summary.partial} partial, ${summary.failed} failed, ${summary.skipped} skipped; `
            + `${summary.usage.totalTokens} tokens across ${summary.usage.requests} request(s); `
            + `estimated cost $${summary.usage.estimatedCostUsd.toFixed(6)}\n`,
          );
        }
        if (abortController.signal.aborted) process.exitCode = interruptedExitCode ?? 1;
        else if (summary.failed > 0 || summary.partial > 0 || summary.costLimitReached) process.exitCode = 1;
      } catch (error) {
        if (interruptedExitCode !== undefined) {
          process.exitCode = interruptedExitCode;
          return;
        }
        throw asCliExitError(error, 1);
      } finally {
        process.removeListener('SIGINT', onSigint);
        process.removeListener('SIGTERM', onSigterm);
      }
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
    .addOption(new Option('--analysis <mode>', 'URL analysis mode').choices([...WEB_ANALYSIS_MODES]).default('individual'))
    .addOption(new Option('--format <format>', 'output format').choices(['markdown', 'json']))
    .option('-o, --output <path>', 'write output to a file instead of stdout')
    .addOption(new Option('--thinking <level>', 'thinking level').choices(['minimal', 'low', 'medium', 'high']))
    .option('--include-thoughts', 'request thought summaries where supported')
    .option('--timeout <seconds>', 'request time limit')
    .option('--max-cost <usd>', 'fail if estimated paid-tier cost reaches this value')
    .option('--requests-per-minute <count>', 'maximum provider API request starts per minute (0 disables)')
    .option('--overwrite', 'replace an existing output file')
    .option('--dry-run', 'validate URLs and configuration without calling a provider')
    .option('--quiet', 'suppress status output on stderr')
    .action(async (rawUrls: string[], flags: ExtractCommandFlags & {
      file?: string;
      config?: string;
      analysis: WebAnalysisMode;
      format?: WebOutputFormat;
      output?: string;
    }) => {
      const cwd = process.cwd();
      loadLocalEnv(cwd);
      const fileConfig = await loadCliConfig(cwd, flags.config);
      const options = resolveCliOptions(
        {
          provider: flags.provider,
          gateway: flags.gateway,
          model: flags.model,
          baseUrl: flags.baseUrl,
          apiKeyEnv: flags.apiKeyEnv,
          cloudflareAccountId: flags.cloudflareAccountId,
          cloudflareGatewayId: flags.cloudflareGatewayId,
          cloudflareTokenEnv: flags.cloudflareTokenEnv,
          cloudflareByok: flags.cloudflareByok,
          cloudflareByokAlias: flags.cloudflareByokAlias,
          cloudflareProvider: flags.cloudflareProvider,
          inputPrice: flags.inputPrice,
          outputPrice: flags.outputPrice,
          thinking: flags.thinking,
          includeThoughts: flags.includeThoughts,
          format: flags.format,
          output: flags.output,
          timeout: flags.timeout,
          maxCost: flags.maxCost,
          requestsPerMinute: flags.requestsPerMinute,
          overwrite: flags.overwrite,
          dryRun: flags.dryRun,
          quiet: flags.quiet,
        },
        { ...fileConfig, mode: 'simple', preset: undefined, schema: undefined },
        cwd,
      );
      if (options.format !== 'markdown' && options.format !== 'json') {
        throw new Error('Web OCR format must be markdown or json');
      }
      const urls = await resolveWebUrls(rawUrls, flags.file, cwd);
      const outputTarget = options.output
        ? await assertWebOutputAvailable(options.output, cwd, options.overwrite)
        : undefined;
      if (options.dryRun) {
        process.stdout.write(`${JSON.stringify({ valid: true, urls, output: outputTarget }, null, 2)}\n`);
        return;
      }

      const abortController = new AbortController();
      let interruptedExitCode: CliExitCode | undefined;
      const interrupt = (exitCode: CliExitCode): void => {
        interruptedExitCode = exitCode;
        abortController.abort(new Error('Interrupted'));
      };
      const onSigint = (): void => interrupt(cliSignalExitCode('SIGINT'));
      const onSigterm = (): void => interrupt(cliSignalExitCode('SIGTERM'));
      process.once('SIGINT', onSigint);
      process.once('SIGTERM', onSigterm);
      const timeout = setTimeout(
        () => abortController.abort(new Error(`Timed out after ${options.timeoutSeconds}s`)),
        options.timeoutSeconds * 1000,
      );
      resetProviderUsage();
      configureProviderRequestPolicy({
        requestsPerMinute: options.requestsPerMinute,
        maxCostUsd: options.maxCostUsd,
      });
      try {
        const result = await runWebExtraction(urls, flags.analysis, options, abortController.signal);
        const content = renderWebResult(result, flags.analysis, options.format);
        if (options.output) await writeWebOutput(content, options.output, cwd, options.overwrite);
        else process.stdout.write(content);
        const usage = getProviderUsage();
        if (!options.quiet) process.stderr.write(
          `Extracted ${urls.length} URL(s); ${usage.totalTokens} tokens across ${usage.requests} request(s); `
          + `estimated cost $${usage.estimatedCostUsd.toFixed(6)}\n`,
        );
        if (options.maxCostUsd !== undefined && usage.estimatedCostUsd >= options.maxCostUsd) {
          process.exitCode = 1;
        }
      } catch (error) {
        if (interruptedExitCode !== undefined) {
          process.exitCode = interruptedExitCode;
          return;
        }
        if (abortController.signal.aborted && abortController.signal.reason instanceof Error) {
          throw asCliExitError(abortController.signal.reason, 1);
        }
        throw asCliExitError(error, 1);
      } finally {
        clearTimeout(timeout);
        resetProviderRequestPolicy();
        process.removeListener('SIGINT', onSigint);
        process.removeListener('SIGTERM', onSigterm);
      }
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
    .description('check local CLI configuration without making an API request')
    .option('--config <path>', 'explicit JSON configuration file')
    .option('--json', 'emit machine-readable JSON')
    .action(async (flags: { config?: string; json?: boolean }) => {
      const cwd = process.cwd();
      loadLocalEnv(cwd);
      const config = await loadCliConfig(cwd, flags.config);
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
        process.stdout.write(`Project config: ${checks.projectConfig}\n`);
        if (!checks.apiKey.ok) process.stdout.write(`${credentialSetupGuidance(apiKeyEnv, cwd, provider)}\n`);
      }
      if (!checks.node.ok || !checks.configuration.ok || !checks.apiKey.ok || !checks.gatewayToken.ok) {
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
      if (process.stdin.isTTY && process.stderr.isTTY) {
        const selectedArguments = await promptInteractiveArguments();
        if (selectedArguments) {
          await createProgram(cliBinaryName(argv)).parseAsync([
            argv[0] ?? 'node',
            argv[1] ?? PRIMARY_CLI_NAME,
            ...selectedArguments,
          ]);
        }
      } else {
        program.outputHelp();
      }
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
