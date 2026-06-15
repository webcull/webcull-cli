import { spawn } from 'node:child_process';

export class CredentialStore {
  constructor({ service = 'webcull-cli', account = 'default', platform = process.platform, runCommand = null } = {}) {
    this.service = service;
    this.account = account;
    this.platform = platform;
    this.runCommand = runCommand || this.realRunCommand;
  }

  async save(token) {
    if (this.platform === 'darwin') {
      await this.runMac('add-generic-password', [
        '-a',
        this.account,
        '-s',
        this.service,
        '-w',
        token,
        '-U'
      ]);
      return;
    }
    if (this.platform === 'win32') {
      await this.runWindows(this.windowsSaveScript(), {
        WEBCULL_CLI_TOKEN: token
      });
      return;
    }
    if (this.platform === 'linux') {
      await this.runSecretTool(['store', '--label', 'WebCull CLI', 'service', this.service, 'account', this.account], {
        input: token
      });
      return;
    }
    throw new Error('OS credential storage is not available on this platform.');
  }

  async read() {
    if (this.platform === 'darwin') {
      try {
        const result = await this.runMac('find-generic-password', [
          '-a',
          this.account,
          '-s',
          this.service,
          '-w'
        ]);
        return String(result.stdout || '').trim() || null;
      } catch (error) {
        if (this.isNotFound(error)) {
          return null;
        }
        throw new Error('Could not read WebCull CLI token from OS credential storage.');
      }
    }
    if (this.platform === 'win32') {
      const result = await this.runWindows(this.windowsReadScript());
      return String(result.stdout || '').trim() || null;
    }
    if (this.platform === 'linux') {
      try {
        const result = await this.runSecretTool(['lookup', 'service', this.service, 'account', this.account]);
        return String(result.stdout || '').trim() || null;
      } catch (error) {
        if (this.isNotFound(error)) {
          return null;
        }
        throw new Error('Could not read WebCull CLI token from OS credential storage.');
      }
    }
    throw new Error('OS credential storage is not available on this platform.');
  }

  async delete() {
    if (this.platform === 'darwin') {
      try {
        await this.runMac('delete-generic-password', [
          '-a',
          this.account,
          '-s',
          this.service
        ]);
      } catch (error) {
        if (!this.isNotFound(error)) {
          throw new Error('Could not delete WebCull CLI token from OS credential storage.');
        }
      }
      return;
    }
    if (this.platform === 'win32') {
      await this.runWindows(this.windowsDeleteScript());
      return;
    }
    if (this.platform === 'linux') {
      try {
        await this.runSecretTool(['clear', 'service', this.service, 'account', this.account]);
      } catch (error) {
        if (!this.isNotFound(error)) {
          throw new Error('Could not delete WebCull CLI token from OS credential storage.');
        }
      }
      return;
    }
  }

  runMac(command, args) {
    return this.runCommand('/usr/bin/security', [command, ...args]);
  }

  runSecretTool(args, options = {}) {
    return this.runCommand('secret-tool', args, options);
  }

  runWindows(script, extraEnv = {}) {
    return this.runCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ], {
      env: {
        WEBCULL_CLI_CREDENTIAL_SERVICE: this.service,
        WEBCULL_CLI_CREDENTIAL_ACCOUNT: this.account,
        ...extraEnv
      }
    });
  }

  realRunCommand(file, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...(options.env || {})
        }
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', chunk => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', error => {
        reject(error);
      });
      child.on('close', code => {
        if (code === 0) {
          resolve({ stdout, stderr, code });
        } else {
          const error = new Error('Credential command failed.');
          error.stdout = stdout;
          error.stderr = stderr;
          error.code = code;
          reject(error);
        }
      });
      if (options.input) {
        child.stdin.end(options.input);
      } else {
        child.stdin.end();
      }
    });
  }

  isNotFound(error) {
    const stderr = String(error.stderr || '');
    return error.code === 1 ||
      stderr.includes('could not be found') ||
      stderr.includes('not found') ||
      stderr.includes('Element not found');
  }

  windowsBaseScript() {
    return `
$ErrorActionPreference = 'Stop'
$source = @"
using System;
using System.Runtime.InteropServices;
public class WebCullCredMan {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct FILETIME {
    public UInt32 dwLowDateTime;
    public UInt32 dwHighDateTime;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll", SetLastError=true)]
  public static extern void CredFree(IntPtr buffer);
}
"@
Add-Type -TypeDefinition $source
$target = $env:WEBCULL_CLI_CREDENTIAL_SERVICE + ':' + $env:WEBCULL_CLI_CREDENTIAL_ACCOUNT
`;
  }

  windowsSaveScript() {
    return this.windowsBaseScript() + `
$bytes = [System.Text.Encoding]::Unicode.GetBytes($env:WEBCULL_CLI_TOKEN)
$blob = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
try {
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
  $credential = New-Object WebCullCredMan+CREDENTIAL
  $credential.Type = 1
  $credential.TargetName = $target
  $credential.UserName = $env:WEBCULL_CLI_CREDENTIAL_ACCOUNT
  $credential.CredentialBlobSize = $bytes.Length
  $credential.CredentialBlob = $blob
  $credential.Persist = 2
  if (-not [WebCullCredMan]::CredWrite([ref] $credential, 0)) {
    throw ('CredWrite failed: ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
} finally {
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
}
`;
  }

  windowsReadScript() {
    return this.windowsBaseScript() + `
$credentialPtr = [IntPtr]::Zero
if (-not [WebCullCredMan]::CredRead($target, 1, 0, [ref] $credentialPtr)) {
  $lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  if ($lastError -eq 1168) { exit 0 }
  throw ('CredRead failed: ' + $lastError)
}
try {
  $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($credentialPtr, [type][WebCullCredMan+CREDENTIAL])
  if ($credential.CredentialBlobSize -gt 0) {
    [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, $credential.CredentialBlobSize / 2)
  }
} finally {
  [WebCullCredMan]::CredFree($credentialPtr)
}
`;
  }

  windowsDeleteScript() {
    return this.windowsBaseScript() + `
if (-not [WebCullCredMan]::CredDelete($target, 1, 0)) {
  $lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  if ($lastError -ne 1168) {
    throw ('CredDelete failed: ' + $lastError)
  }
}
`;
  }
}
