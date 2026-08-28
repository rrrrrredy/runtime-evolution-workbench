import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
);
const packageLock = JSON.parse(
  readFileSync(join(repositoryRoot, "package-lock.json"), "utf8"),
);

const dependencyName = "@runcase/interchange";
const expectedUrl =
  "https://github.com/rrrrrredy/runcase-interchange/releases/download/v0.1.0/runcase-interchange-0.1.0.tgz";
const expectedIntegrity =
  "sha512-y3o4JTiNltlXBaU884B8urJQqtDJNAacL8o526dTep9Nlp2xeHJgOJS1+fQMXkBUqP9VQj1NroccGIpJFgWBbg==";

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} must be exactly ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`,
    );
  }
}

assertEqual(
  packageJson.dependencies?.[dependencyName],
  expectedUrl,
  "package.json RunCase Interchange dependency",
);
assertEqual(
  packageLock.packages?.[""]?.dependencies?.[dependencyName],
  expectedUrl,
  "package-lock root RunCase Interchange dependency",
);

const lockedDependency =
  packageLock.packages?.[`node_modules/${dependencyName}`];
if (!lockedDependency) {
  throw new Error("package-lock is missing the RunCase Interchange package entry.");
}

assertEqual(lockedDependency.version, "0.1.0", "locked protocol version");
assertEqual(lockedDependency.resolved, expectedUrl, "locked protocol source");
assertEqual(
  lockedDependency.integrity,
  expectedIntegrity,
  "locked protocol integrity",
);

for (const value of [
  packageJson.dependencies?.[dependencyName],
  lockedDependency.resolved,
]) {
  if (
    typeof value !== "string" ||
    !value.startsWith("https://github.com/") ||
    /(?:git\+|git@|ssh:)/i.test(value)
  ) {
    throw new Error(
      "RunCase Interchange must be installed from the pinned HTTPS GitHub Release asset.",
    );
  }
}

console.log(
  "Release dependency contract passed: RunCase Interchange v0.1.0 HTTPS asset and SHA-512 are pinned.",
);
