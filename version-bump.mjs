import { readFileSync, writeFileSync } from "fs";

const PACKAGE_PATH = "package.json";
const PACKAGE_LOCK_PATH = "package-lock.json";
const MANIFEST_PATH = "manifest.json";
const VERSIONS_PATH = "versions.json";

const packageJson = readJson(PACKAGE_PATH);
const targetVersion = getTargetVersion(packageJson.version);

packageJson.version = targetVersion;
writeJson(PACKAGE_PATH, packageJson);

const packageLock = readJson(PACKAGE_LOCK_PATH);
packageLock.version = targetVersion;
if (packageLock.packages?.[""]) {
	packageLock.packages[""].version = targetVersion;
}
writeJson(PACKAGE_LOCK_PATH, packageLock);

const manifest = readJson(MANIFEST_PATH);
manifest.version = targetVersion;
writeJson(MANIFEST_PATH, manifest);

const versions = readJson(VERSIONS_PATH);
versions[targetVersion] = manifest.minAppVersion;
writeJson(VERSIONS_PATH, versions);

function getTargetVersion(currentVersion) {
	const requestedVersion = process.argv[2];

	if (requestedVersion === "--patch") {
		return bumpPatch(currentVersion);
	}

	return requestedVersion || process.env.npm_package_version || currentVersion;
}

function bumpPatch(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) {
		throw new Error(`Cannot patch version "${version}". Expected x.y.z.`);
	}

	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]) + 1;
	return `${major}.${minor}.${patch}`;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}
