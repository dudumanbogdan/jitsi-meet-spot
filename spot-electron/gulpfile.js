/* eslint-disable no-console */
/* eslint-disable require-jsdoc */
import gulp from 'gulp';
import clone from 'clone';
import path from 'path';
import pack from './package.json';
import packager from 'electron-packager';
import { gitDescribeSync } from 'git-describe';
import { spawn } from 'child_process';
import zip from 'gulp-zip';
import fs from 'fs-extra';
import { createWindowsInstaller } from 'electron-winstaller';
import PluginError from 'plugin-error';

const buildPath = {};
const describe = gitDescribeSync();
const { tag, distance, hash } = describe;
const fullVersion = `${tag}-${distance}-${hash}`;
const NODE_WINDOWS_EXTERNALS = [
    '@jitsi/windows.devices.bluetooth.advertisement',
    '@jitsi/windows.storage.streams'
];
const DLLS = path.resolve(__dirname, 'dlls');
const WIN_SIGNTOOL_ARGS = [
    '/a',
    '/n',
    '8x8',
    '/tr',
    'http://timestamp.digicert.com',
    '/td',
    'sha256',
    '/fd',
    'sha256'
];
const electronBuildOptions = {
    appCopyright: 'Copyright 2009-2022 8x8 Inc. All rights reserved.',
    appVersion: describe.semver.version,
    buildVersion: `${describe.semver.version}.${describe.distance}`,
    arch: 'x64',
    derefSymlinks: false,
    prune: false,
    dir: './build/dist',
    icon: path.join(__dirname, 'package', '8x8-logo'),
    name: pack.title,
    out: './build/bundle',
    overwrite: true,
    tmpdir: false,
    version: pack.devDependencies.electron // read from package.json directly
};

gulp.task(
  'installer:win',
  gulp.series([
      'build:win',
      'zip',
      installerSquirrelWin
  ])
);

gulp.task(
  'build:win',
  gulp.series([
      'version:export',
      'move:win_node_modules',
      buildWindows,
      copyWindowsDlls
  ])
);

gulp.task('zip', () =>
    gulp
    .src('build/bundle/**/*', { follow: false })
    .pipe(zip.dest('build/spot-win.zip'))
);

// Create a version.json that contains app version + jenkins build id or dev
gulp.task('version:export', cb => {
    const output = {
        distance: describe.distance,
        version: describe.semver.version,
        fullVersion
    };

    console.log(output);
    fs.writeJson('./version.json', output, cb);
});

gulp.task('move:win_node_modules', () =>
    gulp
    .src(
      [

          // windows specific node modules
          ...NODE_WINDOWS_EXTERNALS.map(
          moduleName => `node_modules/${moduleName}/**/*`
          )
      ],
      { base: './' }
    )
    .pipe(gulp.dest('build/dist'))
);

function buildWindows() {
    const opts = clone(electronBuildOptions);

    opts.platform = 'win32';
    opts.arch = 'x64';
    opts.win32metadata = {
        OriginalFilename: `${electronBuildOptions.name}.exe`,
        InternalName: `${electronBuildOptions.name}.exe`
    };
    console.log(`electron-packager options ${JSON.stringify(opts)}`);

    return packager(opts)
.then(appPath => {
    console.log('App built in: ', appPath);

    // Store path to use in installer
    buildPath.win = path.join(__dirname, appPath[0]);
    console.log('singing windows executable');

    return buildPath.win;
})
.then(buildPathWin =>
    signWindowsExecutable(path.join(buildPathWin, `${electronBuildOptions.name}.exe`)
    )
);
}

function signWindowsExecutable(execPath) {
    return new Promise((res, rej) => {
        const codeSignPath = path.join('node_modules', 'electron-winstaller', 'vendor', 'signtool.exe');

        console.log('Code sign path: ', codeSignPath);
        const codeSignArgs = [ 'sign', ...WIN_SIGNTOOL_ARGS, execPath ];

        console.log('codeSignArgs: ', codeSignArgs);
        const cmd = spawn(codeSignPath, codeSignArgs);

        cmd.stdout.on('data', output => {
            console.log('signtool out:', output.toString());
        });

        cmd.stderr.on('data', output => {
            const errorOutput = output.toString();

            console.log('signtool errout:', errorOutput);
            rej(errorOutput); // reject if signtool.exe command wrote to stderr
        });

        cmd.on('exit', res).on('error', err => {
            console.log('signtool fail', err);
            rej(err);
        });
    });
}

function copyWindowsDlls(cb) {
    return fs.copy(DLLS, buildPath.win, cb);
}

function installerSquirrelWin(cb) {
    let installVersion = describe.semver.version;

    if (describe.distance) {
        installVersion += `-b${describe.distance}`;
    }
    const winConfig = {
        appDirectory: buildPath.win,
        authors: pack.author,
        outputDirectory: './build',

        exe: `${electronBuildOptions.name}.exe`,
        setupExe: `${electronBuildOptions.name}.exe`,

        // the name prop of package.json is set as Windows appId by default so we override it
        // this sets the install folder for appdata as well
        name: '8x8-Spaces',
        setupIcon: path.join(__dirname, 'package', '8x8-logo.ico'),
        skipUpdateIcon: true,
        iconUrl: 'https://www.8x8.com/favicon.ico',
        loadingGif: path.join(__dirname, 'package', '8x8-install-win.gif'),

        // overwrite: true,
        version: installVersion,
        noMsi: true
    };

    console.log('windows:squirrel:installer sign with ', WIN_SIGNTOOL_ARGS);
    winConfig.signWithParams = WIN_SIGNTOOL_ARGS.join(' ');
    createWindowsInstaller(winConfig)
    .then(cb)
    .catch(err => {
        throw new PluginError('electron-windows-installer', err);
    });
}
