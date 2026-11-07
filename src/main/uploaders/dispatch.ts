/**
 * Lazy-load the uploader for the active save method so heavy deps
 * (@aws-sdk, ssh2) are not pulled into memory at app startup.
 */
export async function uploadBySaveMethod(
  saveMethod: string,
  fileBuffer: Buffer,
  fileName: string,
  settings: any,
  contentType?: string
): Promise<string> {
  switch (saveMethod) {
    case 's3': {
      const { S3Uploader } = await import('./s3-uploader');
      return new S3Uploader().uploadFile(fileBuffer, fileName, settings, contentType);
    }
    case 'ftp': {
      const { FTPUploader } = await import('./ftp-uploader');
      return new FTPUploader().uploadFile(fileBuffer, fileName, settings);
    }
    case 'ssh': {
      const { SSHUploader } = await import('./ssh-uploader');
      return new SSHUploader().uploadFile(fileBuffer, fileName, settings);
    }
    case 'api': {
      const { ApiUploader } = await import('./api-uploader');
      return new ApiUploader().uploadFile(fileBuffer, fileName, settings, contentType);
    }
    default:
      throw new Error(`Unknown save method: ${saveMethod}`);
  }
}
