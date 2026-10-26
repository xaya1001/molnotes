import { setting } from "./settings.mjs";
export async function storage() {
  const { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } =
    await import("@aws-sdk/client-s3");
  const accountId = setting("MOLNOTES_R2_ACCOUNT_ID");
  const bucket = setting("MOLNOTES_R2_BUCKET");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: setting("MOLNOTES_R2_ACCESS_KEY_ID"),
      secretAccessKey: setting("MOLNOTES_R2_SECRET_ACCESS_KEY"),
    },
  });
  return {
    async fetchObject(key) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return Buffer.from(await result.Body.transformToByteArray());
    },
    async hasObject(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404) return false;
        throw error;
      }
    },
    async putObject(key, bytes) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: "application/octet-stream",
        }),
      );
    },
  };
}
