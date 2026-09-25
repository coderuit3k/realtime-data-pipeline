import { describe, expect, it, vi, beforeEach } from "vitest";
import { PutObjectCommand, GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://example.r2.dev/signed-url"),
}));

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { uploadAndPresign } from "./r2";

const mockedGetSignedUrl = vi.mocked(getSignedUrl);

beforeEach(() => {
  mockedGetSignedUrl.mockClear();
});

describe("uploadAndPresign", () => {
  it("uploads the body with the given bucket/key/contentType", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;

    await uploadAndPresign(client, "excel", "exports/test.xlsx", Buffer.from("data"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    expect(send).toHaveBeenCalledOnce();
    const putCommand = send.mock.calls[0][0] as PutObjectCommand;
    expect(putCommand.input).toEqual({
      Bucket: "excel",
      Key: "exports/test.xlsx",
      Body: Buffer.from("data"),
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  });

  it("returns whatever getSignedUrl resolves to", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;

    const url = await uploadAndPresign(client, "excel", "exports/test.xlsx", Buffer.from("data"), "text/plain");

    expect(url).toBe("https://example.r2.dev/signed-url");
  });

  it("defaults the presigned URL to a 600-second expiry", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;

    await uploadAndPresign(client, "excel", "exports/test.xlsx", Buffer.from("data"), "text/plain");

    expect(mockedGetSignedUrl).toHaveBeenCalledWith(client, expect.any(GetObjectCommand), { expiresIn: 600 });
  });

  it("passes a custom expiresInSeconds through to getSignedUrl", async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as S3Client;

    await uploadAndPresign(client, "excel", "exports/test.xlsx", Buffer.from("data"), "text/plain", 120);

    expect(mockedGetSignedUrl).toHaveBeenCalledWith(client, expect.any(GetObjectCommand), { expiresIn: 120 });
  });
});
