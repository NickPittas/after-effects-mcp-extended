// install-bridge.js
// Script to install the After Effects MCP Bridge to the ScriptUI Panels folder
import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES Modules replacement for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect platform
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

// Possible After Effects installation paths (common locations)
const possiblePaths = isMac
  ? [
      '/Applications/Adobe After Effects 2026',
      '/Applications/Adobe After Effects 2025',
      '/Applications/Adobe After Effects 2024',
      '/Applications/Adobe After Effects 2023',
      '/Applications/Adobe After Effects 2022',
      '/Applications/Adobe After Effects 2021'
    ]
  : [
      'C:\\Program Files\\Adobe\\Adobe After Effects 2026',
      'C:\\Program Files\\Adobe\\Adobe After Effects 2025',
      'C:\\Program Files\\Adobe\\Adobe After Effects 2024',
      'C:\\Program Files\\Adobe\\Adobe After Effects 2023',
      'C:\\Program Files\\Adobe\\Adobe After Effects 2022',
      'C:\\Program Files\\Adobe\\Adobe After Effects 2021'
    ];

// Find valid After Effects installation
let afterEffectsPath = null;
for (const testPath of possiblePaths) {
  if (fs.existsSync(testPath)) {
    afterEffectsPath = testPath;
    break;
  }
}

if (!afterEffectsPath) {
  console.error('Error: Could not find After Effects installation.');
  console.error('Please manually copy the bridge script to your After Effects ScriptUI Panels folder.');
  console.error('Source: build/scripts/mcp-bridge-auto.jsx');
  if (isMac) {
    console.error('Target: /Applications/Adobe After Effects [VERSION]/Scripts/ScriptUI Panels/');
  } else {
    console.error('Target: C:\\Program Files\\Adobe\\Adobe After Effects [VERSION]\\Support Files\\Scripts\\ScriptUI Panels\\');
  }
  process.exit(1);
}

// Define source and destination paths
const sourceScript = path.join(__dirname, 'build', 'scripts', 'mcp-bridge-auto.jsx');
const destinationFolder = isMac
  ? path.join(afterEffectsPath, 'Scripts', 'ScriptUI Panels')
  : path.join(afterEffectsPath, 'Support Files', 'Scripts', 'ScriptUI Panels');
const destinationScript = path.join(destinationFolder, 'mcp-bridge-auto.jsx');
const chatHostScript = path.join(__dirname, 'build', 'chat-host.js');
const developmentBinFolder = path.join(process.env.USERPROFILE || '', 'Documents', 'ae-mcp-bridge', 'bin');
const developmentChatTarget = path.join(developmentBinFolder, 'chat-host.js');
const releaseFolder = path.join(process.env.APPDATA || '', 'AfterEffectsMCP');
const standaloneMcpSource = path.join(__dirname, 'dist', 'after-effects-mcp-extended.exe');
const standaloneChatSource = path.join(__dirname, 'dist', 'after-effects-codex-chat.exe');

// Ensure source script exists
if (!fs.existsSync(sourceScript)) {
  console.error(`Error: Source script not found at ${sourceScript}`);
  console.error('Please run "npm run build" first to generate the script.');
  process.exit(1);
}

// Create destination folder if it doesn't exist
if (!fs.existsSync(destinationFolder)) {
  try {
    fs.mkdirSync(destinationFolder, { recursive: true });
  } catch (error) {
    console.error(`Error creating destination folder: ${error.message}`);
    console.error('You may need administrative privileges to install the script.');
    process.exit(1);
  }
}

// Copy the script
try {
  console.log(`Installing bridge script to ${destinationScript}...`);

  if (isMac) {
    // On Mac, try direct copy first, then sudo if needed
    try {
      fs.copyFileSync(sourceScript, destinationScript);
    } catch {
      // If direct copy fails, try with sudo
      execSync(`sudo cp "${sourceScript}" "${destinationScript}"`, { stdio: 'inherit' });
    }
  } else {
    // Run the copy in an elevated PowerShell process and wait for its real exit code.
    const quotePowerShell = (value) => value.replace(/'/g, "''");
    const copyCommand =
      `Copy-Item -LiteralPath '${quotePowerShell(sourceScript)}' ` +
      `-Destination '${quotePowerShell(destinationScript)}' -Force`;
    const encodedCommand = Buffer.from(copyCommand, 'utf16le').toString('base64');
    const elevationCommand =
      `$process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru ` +
      `-ArgumentList '-NoProfile','-EncodedCommand','${encodedCommand}'; ` +
      `exit $process.ExitCode`;
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', elevationCommand],
      { stdio: 'inherit' }
    );
  }

  if (
    !fs.existsSync(destinationScript) ||
    !fs.readFileSync(sourceScript).equals(fs.readFileSync(destinationScript))
  ) {
    throw new Error('Bridge copy verification failed: installed file differs from the build output.');
  }

  // Keep a development fallback for this workstation, while release installs
  // use the self-contained executables and do not require Node.js or npm.
  fs.mkdirSync(developmentBinFolder, { recursive: true });
  fs.copyFileSync(chatHostScript, developmentChatTarget);
  if (fs.existsSync(standaloneMcpSource) && fs.existsSync(standaloneChatSource)) {
    fs.mkdirSync(releaseFolder, { recursive: true });
    fs.copyFileSync(standaloneMcpSource, path.join(releaseFolder, 'after-effects-mcp-extended.exe'));
    fs.copyFileSync(standaloneChatSource, path.join(releaseFolder, 'after-effects-codex-chat.exe'));
  }

  console.log('Bridge script installed successfully!');
  console.log('\nImportant next steps:');
  console.log('1. Open After Effects');
  if (isMac) {
    console.log('2. Go to After Effects > Settings > Scripting & Expressions');
  } else {
    console.log('2. Go to Edit > Preferences > Scripting & Expressions');
  }
  console.log('3. Enable "Allow Scripts to Write Files and Access Network"');
  console.log('4. Restart After Effects');
  console.log('5. Open the bridge panel: Window > mcp-bridge-auto.jsx');
} catch (error) {
  console.error(`Error installing script: ${error.message}`);
  console.error('\nPlease try manual installation:');
  console.error(`1. Copy: ${sourceScript}`);
  console.error(`2. To: ${destinationScript}`);
  if (isMac) {
    console.error('3. You may need to run with sudo or copy manually via Finder');
  } else {
    console.error('3. You may need to run as administrator or use File Explorer with admin rights');
  }
  process.exit(1);
}
