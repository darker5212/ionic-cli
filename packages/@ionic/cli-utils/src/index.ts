import * as path from 'path';

import chalk from 'chalk';
import * as Debug from 'debug';

import { LOGGER_LEVELS, PackageJson, createPromptModule, createTaskChainWithOutput, parseArgs } from '@ionic/cli-framework';
import { findBaseDirectory } from '@ionic/cli-framework/utils/fs';
import { readPackageJsonFile } from '@ionic/cli-framework/utils/npm';
import { TERMINAL_INFO } from '@ionic/cli-framework/utils/terminal';

import { PROJECT_FILE } from './constants';
import { IProject, InfoItem, IonicContext, IonicEnvironment } from './definitions';
import { OutsideProject, Project, ProjectDeps } from './lib/project';
import { ERROR_VERSION_TOO_OLD } from './bootstrap';
import { CONFIG_FILE, Config, DEFAULT_CONFIG_DIRECTORY, gatherFlags } from './lib/config';
import { Client } from './lib/http';
import { Environment } from './lib/environment';
import { PROXY_ENVIRONMENT_VARIABLES } from './lib/utils/http';
import { Logger } from './lib/utils/logger';
import { ProSession } from './lib/session';
import { Shell } from './lib/shell';
import { createOnFallback } from './lib/prompts';

export * from './definitions';
export * from './constants';
export * from './guards';

const PACKAGE_ROOT_PATH = path.dirname(__filename);
const PACKAGE_JSON_PATH = path.resolve(PACKAGE_ROOT_PATH, 'package.json');

const name = '@ionic/cli-utils';
const debug = Debug('ionic:cli-utils');

let _pkg: PackageJson | undefined;

export async function getProject(projectDir: string | undefined, deps: ProjectDeps): Promise<IProject> {
  if (!projectDir) {
    return new OutsideProject('', PROJECT_FILE);
  }

  const type = await Project.determineType(projectDir, deps);

  if (!type) {
    return new OutsideProject('', PROJECT_FILE);
  }

  return Project.createFromProjectType(projectDir, PROJECT_FILE, deps, type);
}

async function loadPackageJson(): Promise<PackageJson> {
  if (!_pkg) {
    _pkg = await readPackageJsonFile(PACKAGE_JSON_PATH);
  }

  return _pkg;
}

export async function generateIonicEnvironment(ctx: IonicContext, pargv: string[], env: { [key: string]: string; }): Promise<IonicEnvironment> {
  process.chdir(ctx.execPath);

  const argv = parseArgs(pargv, { boolean: true, string: '_' });
  const config = new Config(env['IONIC_CONFIG_DIRECTORY'] || DEFAULT_CONFIG_DIRECTORY, CONFIG_FILE);
  const flags = gatherFlags(argv);

  const configData = await config.load();
  debug('Terminal info: %o', TERMINAL_INFO);

  if (configData.interactive === false || !TERMINAL_INFO.tty || TERMINAL_INFO.ci) {
    flags.interactive = false;
  }

  const log = new Logger({
    level: argv['quiet'] ? LOGGER_LEVELS.WARN : LOGGER_LEVELS.INFO,
    handlers: new Set(),
  });

  const prompt = await createPromptModule({ interactive: flags.interactive, onFallback: createOnFallback({ ...flags, log }) });
  const tasks = createTaskChainWithOutput(
    flags.interactive
      ? { output: prompt.output }
      : { output: { stream: log.createWriteStream(LOGGER_LEVELS.INFO, false) } }
  );

  const projectDir = await findBaseDirectory(ctx.execPath, PROJECT_FILE);
  const proxyVars = PROXY_ENVIRONMENT_VARIABLES.map(e => [e, env[e]]).filter(([e, v]) => !!v);

  const getInfo = async () => {
    const pkg = await loadPackageJson();
    const osName = await import('os-name');
    const os = osName();
    const node = process.version;

    const npm = await shell.cmdinfo('npm', ['-v']);

    const info: InfoItem[] = [
      { type: 'cli-packages', key: name, value: pkg.version, path: PACKAGE_ROOT_PATH },
      { type: 'cli-packages', key: 'ionic', flair: 'Ionic CLI', value: ctx.version, path: path.dirname(path.dirname(ctx.libPath)) },
      { type: 'system', key: 'NodeJS', value: node },
      { type: 'system', key: 'npm', value: npm || 'not installed' },
      { type: 'system', key: 'OS', value: os },
    ];

    info.push(...proxyVars.map(([e, v]): InfoItem => ({ type: 'environment', key: e, value: v })));
    info.push(...(await project.getInfo()));

    return info;
  };

  const shell = new Shell({ log, projectDir });
  const project = await getProject(projectDir, { config, log, shell, tasks });
  const client = new Client(config);
  const session = new ProSession({ config, client, project });

  await config.prepare();

  const ienv = new Environment({
    client,
    config,
    flags,
    getInfo,
    log,
    ctx,
    prompt,
    project,
    session,
    shell,
    tasks,
  });

  ienv.open();

  if (env['IONIC_CLI_LOCAL_ERROR']) {
    if (env['IONIC_CLI_LOCAL_ERROR'] === ERROR_VERSION_TOO_OLD) {
      log.warn(`Detected locally installed Ionic CLI, but it's too old--using global CLI.`);
    }
  }

  debug('CLI flags: %o', flags);

  if (typeof argv['yarn'] === 'boolean') {
    log.warn(`${chalk.green('--yarn')} / ${chalk.green('--no-yarn')} was removed in CLI 4.0. Use ${chalk.green(`ionic config set -g npmClient ${argv['yarn'] ? 'yarn' : 'npm'}`)}.`);
  }

  return ienv;
}
