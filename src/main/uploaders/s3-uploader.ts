import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class S3Uploader {
    private s3Client: S3Client;

    constructor() {
        // Клиент будет инициализирован при загрузке с настройками
        this.s3Client = new S3Client({});
    }

    private initializeClient(settings: any) {
        this.s3Client = new S3Client({
            region: settings.s3.region,
            endpoint: settings.s3.endpoint || undefined,
            credentials: {
                accessKeyId: settings.s3.accessKeyId,
                secretAccessKey: settings.s3.secretAccessKey,
            },
        });
    }

    private async generatePresignedUrl(bucket: string, key: string, contentType: string): Promise<string> {
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: contentType,
        });

        return await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
    }

  async uploadFile(fileBuffer: Buffer, fileName: string, settings: any): Promise<string> {
    console.log(`🚀 Начало загрузки файла в S3: ${fileName}`);
    console.log(`📊 Размер файла: ${fileBuffer.length} байт`);
    
    this.initializeClient(settings);
    
    const fileExt = fileName.split('.').pop() || 'png';
    const key = `screenshots/${Date.now()}-${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
    
    console.log(`🔑 Генерация ключа для S3: ${key}`);

    try {
        console.log(`📤 Отправка файла в S3...`);
        const startTime = Date.now();

        const command = new PutObjectCommand({
            Bucket: settings.s3.bucket,
            Key: key,
            Body: fileBuffer,
            ContentType: 'image/png',
        });

        const response = await this.s3Client.send(command);
        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log(`✅ Файл успешно загружен за ${duration}ms`);
        console.log(`🎉 S3 ответ:`, response);
        console.log(`📍 Полный путь: s3://${settings.s3.bucket}/${key}`);
        
        return key;
        
    } catch (error) {
        console.error(`💥 Ошибка загрузки в S3:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`📝 Детали ошибки: ${errorMessage}`);
        throw error;
    }
}
}