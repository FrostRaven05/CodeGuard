const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { GitService, runGit } = require('../electron/git-service.cjs');
const { atomicJson } = require('../electron/model-settings.cjs');
const { ReviewService } = require('../electron/review-service.cjs');
const { cases } = require('../tests/fixtures/review-cases.cjs');

async function validateModel(
  settings,
  {
    reportDirectory,
    onProgress = () => {},
    transport = {},
    kind = 'configured-model-synthetic-cases',
    cleanupImpl = fs.rmSync,
  },
) {
  const publicSettings = settings.getPublic();
  settings.connection();
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'codeguard-model-validation-'));
  const reportFile = path.resolve(
    reportDirectory,
    `${Date.now()}-${require('node:crypto').randomUUID()}.json`,
  );
  const report = {
    kind,
    startedAt: new Date().toISOString(),
    configuration: publicSettings,
    cost: null,
    cases: [],
    limitation:
      '位置核对只确认引用；语义结论需人工对照 oracle，未评定的误报、漏报为未知。最多 4 次请求，不重试，不发送用户源码。',
  };
  try {
    for (const item of cases) {
      const root = path.join(owned, item.id);
      fs.mkdirSync(root);
      await runGit(root, ['init', '--initial-branch=main']);
      for (const [key, value] of [
        ['user.name', 'CodeGuard Validation'],
        ['user.email', 'validation@example.invalid'],
        ['commit.gpgsign', 'false'],
        ['core.autocrlf', 'false'],
        ['core.hooksPath', path.join(owned, 'no-hooks')],
      ])
        await runGit(root, ['config', key, value]);
      fs.writeFileSync(path.join(root, item.path), item.before);
      fs.writeFileSync(path.join(root, `test_${item.path}`), item.test);
      await runGit(root, ['add', '--all']);
      await runGit(root, ['commit', '-m', 'synthetic baseline']);
      fs.writeFileSync(path.join(root, item.path), item.after);
      await runGit(root, ['add', '--', item.path]);
      const git = new GitService(path.join(owned, `state-${item.id}`));
      const { id } = await git.addRepository(root);
      const service = new ReviewService(git, settings, transport);
      const record = {
        id: item.id,
        expected: { buggy: item.buggy, oracle: item.oracle, anchor: item.anchor },
        assessment: { complete: false, knownBugFound: null, verdicts: {}, notes: '' },
      };
      const began = Date.now();
      try {
        record.preview = await service.prepare(id);
        record.result = await service.start(id, record.preview.token);
        record.protocol = 'accepted-json';
        record.location = {
          accepted: record.result.findings.length,
          rejected: record.result.unverifiedCount,
        };
      } catch (error) {
        record.protocol = 'failed';
        record.errorCode = typeof error.code === 'string' ? error.code : 'VALIDATION_FAILED';
      }
      record.durationMs = Date.now() - began;
      record.usage = service.metrics.get(id)?.usage || null;
      record.cost = null;
      report.cases.push(record);
      atomicJson(reportFile, report);
      onProgress({
        case: item.id,
        protocol: record.protocol,
        durationMs: record.durationMs,
        usage: record.usage,
        semanticAssessment: 'pending',
        cost: null,
      });
      // Avoid repeating authentication/network errors against a real provider.
      if (record.protocol === 'failed') break;
    }
  } finally {
    const resolved = path.resolve(owned);
    report.finishedAt = new Date().toISOString();
    report.cleanup = { status: 'completed' };
    try {
      if (
        path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('codeguard-model-validation-')
      )
        throw Object.assign(new Error('Unexpected validation directory'), {
          code: 'UNSAFE_TARGET',
        });
      cleanupImpl(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      report.cleanup = {
        status: 'retained',
        directory: resolved,
        errorCode:
          typeof error.code === 'string' && /^[A-Z_]{1,40}$/.test(error.code)
            ? error.code
            : 'CLEANUP_FAILED',
      };
    }
    atomicJson(reportFile, report);
  }
  return { reportFile, report };
}
module.exports = { validateModel };
