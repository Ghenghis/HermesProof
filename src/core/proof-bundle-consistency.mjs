import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function inspectProofBundleConsistency({ proofFile, bundleFile }) {
  const proof = await readFile(proofFile);
  const proofSha256 = sha256(proof);
  let rawBundle;
  try {
    rawBundle = await readFile(bundleFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { present: false, matches: null, proofSha256, bundleSha256: null };
    }
    throw error;
  }

  let bundleSha256;
  try {
    const bundle = JSON.parse(rawBundle);
    const encodedBody = bundle?.rekorBundle?.Payload?.body;
    if (typeof encodedBody !== "string" || !encodedBody) {
      throw new Error("Rekor payload body is missing");
    }
    const payload = JSON.parse(Buffer.from(encodedBody, "base64").toString("utf8"));
    bundleSha256 = payload?.spec?.data?.hash?.value;
    if (!/^[a-f0-9]{64}$/iu.test(bundleSha256 || "")) {
      throw new Error("Rekor payload does not contain a canonical sha256 digest");
    }
    bundleSha256 = bundleSha256.toLowerCase();
  } catch (error) {
    throw new Error(`Invalid proof Sigstore bundle: ${error.message}`, { cause: error });
  }

  return {
    present: true,
    matches: crypto.timingSafeEqual(
      Buffer.from(proofSha256, "hex"),
      Buffer.from(bundleSha256, "hex")
    ),
    proofSha256,
    bundleSha256
  };
}
