const { appendFileSync, readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');

function packageVersions(lock) {
  const versions = new Map();
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const add = (path, entry) => {
    if (!isObject(entry)) throw new Error(`Invalid package entry: ${path}`);
    if (entry.version !== undefined && typeof entry.version !== 'string') {
      throw new Error(`Invalid package version: ${path}`);
    }
    if (!entry.link && entry.version) versions.set(path, entry.version);
  };

  if (!isObject(lock)) throw new Error('Expected an npm lockfile object');
  if (lock.packages !== undefined) {
    if (!isObject(lock.packages)) throw new Error('Invalid packages object');
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (path !== '') add(path, entry);
    }
  } else if (isObject(lock.dependencies)) {
    const visit = (dependencies, parent = '') => {
      if (!isObject(dependencies)) throw new Error('Invalid dependencies object');
      for (const [name, entry] of Object.entries(dependencies)) {
        const path = `${parent}node_modules/${name}`;
        add(path, entry);
        if (entry.dependencies !== undefined) visit(entry.dependencies, `${path}/`);
      }
    };
    visit(lock.dependencies);
  } else {
    throw new Error('Expected npm packages or dependencies in the lockfile');
  }
  return versions;
}

function diffLocks(before, after) {
  const oldVersions = packageVersions(before);
  const newVersions = packageVersions(after);
  return [...new Set([...oldVersions.keys(), ...newVersions.keys()])].sort().flatMap((path) => {
    if (!oldVersions.has(path)) return [`${path} added`];
    if (!newVersions.has(path)) return [`${path} removed`];
    const oldVersion = oldVersions.get(path);
    const newVersion = newVersions.get(path);
    return oldVersion === newVersion ? [] : [`${path} ${oldVersion} -> ${newVersion}`];
  }).join('\n');
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node lock-diff.cjs OLD_LOCK NEW_LOCK');
    const [before, after] = process.argv.slice(2).map((path) => JSON.parse(readFileSync(path, 'utf8')));
    const summary = diffLocks(before, after);
    if (process.env.GITHUB_OUTPUT) {
      const delimiter = `lock_diff_${randomUUID()}`;
      appendFileSync(process.env.GITHUB_OUTPUT, `diff<<${delimiter}\n${summary}\n${delimiter}\n`);
    }
    if (summary) console.log(summary);
  } catch (error) {
    console.error(`lock-diff: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { diffLocks };
