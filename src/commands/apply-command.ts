import chalk from "chalk";
import { Command } from "commander";
import { decorate, inject, injectable } from "inversify";

import { TYPES } from "../container/identifiers.ts";
import { ApplyCliReporter } from "./apply-command-reporter.ts";
import { ApplyCommandRunner } from "./apply-command-runner.ts";
import { createApplyCommandEventBus, type ApplyOptions } from "./apply-command-types.ts";
import type { CliCommand } from "./types.ts";

export class ApplyCommand implements CliCommand {
  private readonly runner: ApplyCommandRunner;
  private readonly defaultConfigDirectory: string;
  private readonly defaultLockfilePath: string;

  public constructor(
    runner: ApplyCommandRunner,
    defaultConfigDirectory: string,
    defaultLockfilePath: string,
  ) {
    this.runner = runner;
    this.defaultConfigDirectory = defaultConfigDirectory;
    this.defaultLockfilePath = defaultLockfilePath;
  }

  public register(program: Command): void {
    program
      .command("apply")
      .alias("APPLY")
      .description(
        "Read config/*.yaml, validate it, and sync Caddy, Cloudflare Tunnel, and DNS publications.",
      )
      .option("-c, --config <path>", "Path to the config directory", this.defaultConfigDirectory)
      .option("-l, --lockfile <path>", "Path to the managed state lockfile", this.defaultLockfilePath)
      .option("--dry-run", "Validate and prepare publication changes without sending remote writes")
      .option(
        "--recreate-lockfile",
        "Force reconciliation and rewrite the managed state lockfile for the selected scope",
      )
      .option("--slow-running", "Add a 700ms delay to each apply operation for UX validation")
      .option("--server <id>", "Only apply Caddy-published services for one server id")
      .action(this.createActionHandler());
  }

  private createActionHandler(): (options: ApplyOptions) => Promise<void> {
    return async (options: ApplyOptions): Promise<void> => {
      const eventBus = createApplyCommandEventBus();
      const reporter = new ApplyCliReporter();
      const detachReporter = reporter.attach(eventBus);

      try {
        await this.runner.run(
          {
            config: options.config,
            dryRun: Boolean(options.dryRun),
            lockfile: options.lockfile,
            recreateLockfile: Boolean(options.recreateLockfile),
            server: options.server,
            slowRunning: Boolean(options.slowRunning),
          },
          eventBus,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(message));
        process.exitCode = 1;
      } finally {
        detachReporter();
      }
    };
  }
}

decorate(injectable(), ApplyCommand);
decorate(inject(TYPES.ApplyCommandRunner), ApplyCommand, 0);
decorate(inject(TYPES.DefaultConfigDirectory), ApplyCommand, 1);
decorate(inject(TYPES.DefaultLockfilePath), ApplyCommand, 2);
