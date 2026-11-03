const { ChildProcess, spawnSync } = require('node:child_process');

function stopOwnedTestProcess(child) {
  if (!(child instanceof ChildProcess) || child.pid === process.pid) throw Error('Expected an owned child process');
  return (async () => {
    try {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve));
        if (process.platform === 'win32') {
          const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
          if (result.error) throw result.error;
          if (result.status !== 0 && child.exitCode === null) child.kill();
        } else child.kill('SIGTERM');
        let timer;
        try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned child exit timeout')), 15000); })]); }
        finally { clearTimeout(timer); }
      }
    } finally {
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
  })();
}
module.exports = { stopOwnedTestProcess };
