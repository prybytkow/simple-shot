// Создаем простую декларацию для ssh2-sftp-client
interface SSH2SFTPClient {
    connect(config: any): Promise<void>;
    mkdir(path: string, recursive?: boolean): Promise<void>;
    put(data: Buffer | string, remotePath: string): Promise<void>;
    end(): Promise<void>;
}

// Используем require вместо import для модуля без типов
const Client = require('ssh2-sftp-client');

export class SSHUploader {
    async uploadFile(fileBuffer: Buffer, fileName: string, settings: any): Promise<string> {
        const sftp: SSH2SFTPClient = new Client();
        
        try {
            await sftp.connect({
                host: settings.ssh.host,
                port: settings.ssh.port,
                username: settings.ssh.username,
                password: settings.ssh.password,
                privateKey: settings.ssh.privateKeyPath ? 
                    require('fs').readFileSync(settings.ssh.privateKeyPath) : undefined,
            });

            const destinationPath = settings.ssh.destinationPath;
            const fullPath = `${destinationPath}/${fileName}`;

            await sftp.mkdir(destinationPath, true);
            await sftp.put(fileBuffer, fullPath);
            
            return fullPath;
        } finally {
            await sftp.end();
        }
    }
}