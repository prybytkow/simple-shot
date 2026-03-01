import { dialog } from 'electron';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export function setupSSHHandler(): void {
  // Handle file save operations
}

export async function saveFile(imageData: Buffer, defaultPath?: string): Promise<string> {
  const result = await dialog.showSaveDialog({
    title: 'Save Screenshot',
    defaultPath: defaultPath || path.join(require('os').homedir(), 'screenshot.png'),
    filters: [
      { name: 'PNG Image', extensions: ['png'] },
      { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }
    ]
  });
  
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, imageData);
    return result.filePath;
  }
  
  throw new Error('Save operation cancelled');
}

export function transferViaSSH(imagePath: string, sshConfig: SSHConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const { host, username, port, destinationPath } = sshConfig;
    const scpCommand = `scp -P ${port} ${imagePath} ${username}@${host}:${destinationPath}`;
    
    exec(scpCommand, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`SSH transfer failed: ${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

export interface SSHConfig {
  host: string;
  username: string;
  port: number;
  destinationPath: string;
  privateKeyPath?: string;
}