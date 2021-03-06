import chalk from 'chalk';

import { ERROR_SHELL_COMMAND_NOT_FOUND, ShellCommandError } from '@ionic/cli-framework';
import { Command } from '@ionic/cli-utils/lib/command';
import { FatalException } from '@ionic/cli-utils/lib/errors';

export abstract class SSHBaseCommand extends Command {
  async checkForOpenSSH() {
    try {
      await this.env.shell.run('ssh', ['-V'], { showCommand: false, fatalOnNotFound: false });
    } catch (e) {
      if (!(e instanceof ShellCommandError && e.code === ERROR_SHELL_COMMAND_NOT_FOUND)) {
        throw e;
      }

      this.env.log.warn('OpenSSH not found on your computer.'); // TODO: more helpful message

      throw new FatalException(`Command not found: ${chalk.bold('ssh')}`);
    }
  }
}
