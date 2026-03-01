import { Client } from 'basic-ftp';
import { Readable } from 'stream';

export class FTPUploader {
    async uploadFile(fileBuffer: Buffer, fileName: string, settings: any): Promise<string> {
        const client = new Client();
        client.ftp.verbose = true; // Для отладки
        
        try {
            await client.access({
                host: settings.ftp.host,
                port: settings.ftp.port,
                user: settings.ftp.username,
                password: settings.ftp.password,
                secure: settings.ftp.secure,
            });

            const destinationPath = settings.ftp.destinationPath;
            await client.ensureDir(destinationPath);

            // Создаем поток из буфера
            const stream = Readable.from(fileBuffer);
            
            // Загрузка файла через поток
            await client.uploadFrom(stream, `${destinationPath}/${fileName}`);
            
            return `${destinationPath}/${fileName}`;
        } finally {
            client.close();
        }
    }
}