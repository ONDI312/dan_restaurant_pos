import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = "product-images";
const imageKeyPattern = /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;
let client: S3Client | undefined;

export function isProductImageKey(value: string): boolean {
  return imageKeyPattern.test(value);
}

function getClient(): S3Client {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION } = process.env;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_ENDPOINT_URL_S3 || !AWS_REGION) {
    throw new Error("Neon Object Storage is not configured for this branch.");
  }
  client ??= new S3Client({
    region: AWS_REGION,
    endpoint: AWS_ENDPOINT_URL_S3,
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
    forcePathStyle: true,
  });
  return client;
}

export async function uploadProductImage(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: "private, max-age=3600",
  }));
}

export async function deleteProductImage(key: string): Promise<void> {
  if (!isProductImageKey(key)) throw new Error("Invalid product image key.");
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function resolveProductImage(imagePath: string | null): Promise<string | null> {
  if (!imagePath) return null;
  try {
    const url = new URL(imagePath);
    if (url.protocol === "http:" || url.protocol === "https:") return imagePath;
  } catch {
    if (!isProductImageKey(imagePath)) return null;
  }
  if (!isProductImageKey(imagePath)) return null;
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: bucket, Key: imagePath }),
    { expiresIn: 3600 },
  );
}
