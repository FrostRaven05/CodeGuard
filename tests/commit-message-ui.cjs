// Hidden, disposable full-App renderer test. No real model or desktop input.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { GitService, runGit } = require('../electron/git-service.cjs');
const { ModelSettings } = require('../electron/model-settings.cjs');
const { ReviewService } = require('../electron/review-service.cjs');
const { createWorkbenchWindow } = require('../electron/workbench-window.cjs');
const owned = process.env.CODEGUARD_SMOKE_ROOT;
assert.ok(owned && path.basename(owned).startsWith('codeguard-desktop-test-'));
app.setPath('userData', path.join(owned, 'profile'));
app
  .whenReady()
  .then(async () => {
    const git = new GitService(path.join(owned, 'state'));
    const repositories = [];
    for (const name of ['repo-a', 'repo-b']) {
      const root = path.join(owned, name);
      fs.mkdirSync(root);
      await runGit(root, ['init', '--initial-branch=main']);
      fs.writeFileSync(path.join(root, name + '.ts'), 'export const value = 1;\n');
      await runGit(root, ['add', '--all']);
      const repository = await git.addRepository(root);
      git.saveDraft(repository.id, `人工草稿 ${name}`);
      repositories.push(repository);
    }
    const [a, b] = repositories;
    git.selectRepository(a.id);
    const settings = new ModelSettings(git.storageDirectory, { sessionOnly: true });
    settings.save({
      baseUrl: 'http://127.0.0.1:1',
      model: 'offline',
      maxContextChars: 60000,
      excludePatterns: '',
    });
    const requests = [];
    let generationGate;
    const reviews = new ReviewService(git, settings, {
      fetchImpl: async (_url, options) => {
        const input = JSON.parse(JSON.parse(options.body).messages[1].content);
        const file = input.files[0].path;
        requests.push(file);
        if (file === 'repo-a.ts' && generationGate) {
          const gate = generationGate;
          gate.entered.resolve();
          await gate.promise;
        }
        return Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify({ message: `feat: 生成 ${file}` }) },
            },
          ],
        });
      },
    });
    const window = await createWorkbenchWindow(git, { visible: false, reviews });
    const execute = (source) => window.webContents.executeJavaScript(source);
    const wait = (condition) =>
      execute(`new Promise((resolve, reject) => {
    const timer = setInterval(() => { if (${condition}) { clearInterval(timer); clearTimeout(deadline); resolve(); } }, 10);
    const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('Commit lifecycle: ' + ${JSON.stringify(condition)} + ' | ' + document.querySelector('.draft-caption')?.textContent)); }, 2000);
  })`);
    const ready = () =>
      wait(
        "document.querySelector('.generate-commit-button') && !document.querySelector('.generate-commit-button').disabled",
      );
    const select = async (name) => {
      await execute("document.querySelector('.repository-trigger').click()");
      await wait("document.querySelectorAll('.repository-option').length === 2");
      await execute(
        `[...document.querySelectorAll('.repository-option')].find(item => item.querySelector('strong').textContent === ${JSON.stringify(name)}).click()`,
      );
      await wait(
        `document.querySelector('.repository-trigger span').textContent === ${JSON.stringify(name)}`,
      );
      await ready();
    };
    // Invoke the real React click handler and retain its promise. Unlike the main
    // service's completion signal, this includes the renderer's catch/finally.
    // The full desktop smoke separately covers native DOM click dispatch.
    const clickGenerate = () =>
      execute(`(() => {
      const button = document.querySelector('.generate-commit-button');
      const props = button[Object.keys(button).find(key => key.startsWith('__reactProps$'))];
      const work = props.onClick();
      if (!work || typeof work.then !== 'function') throw new Error('Generation handler must return its completion promise');
      (window.__commitTasks ||= []).push(work);
      return window.__commitTasks.length - 1;
    })()`);
    const settled = async (index) => {
      await execute(`window.__commitTasks[${index}]`);
      // Drain React's queued render after the awaited task, with no timed delay.
      await execute('new Promise(resolve => setTimeout(resolve, 0))');
    };
    const originalPrepare = reviews.commitMessages.prepare.bind(reviews.commitMessages);
    const holds = [];
    reviews.commitMessages.prepare = async (id) => {
      if (id !== a.id) return originalPrepare(id);
      const gate = Promise.withResolvers();
      holds.push(gate);
      await gate.promise;
      return originalPrepare(id);
    };
    const entered = async (count) => {
      for (let attempt = 0; attempt < 100 && holds.length < count; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(holds.length, count);
    };
    try {
      await ready();
      const switchedPreparation = await clickGenerate();
      await entered(1);
      await wait("document.querySelector('.draft-caption')?.textContent.includes('准备暂存内容')");
      await select('repo-b');
      await clickGenerate();
      await wait("document.querySelector('#commit-message').value === 'feat: 生成 repo-b.ts'");
      holds[0].resolve();
      await settled(switchedPreparation);
      await ready();
      assert.deepEqual(requests, ['repo-b.ts']);
      assert.equal(git.getWorkspace().drafts[a.id], '人工草稿 repo-a');
      console.log(
        'PASS: actual App remounts composer when switching repositories; held old task neither blocks new generation nor overwrites drafts.',
      );

      await select('repo-a');
      const cancelledPreparation = await clickGenerate();
      await entered(2);
      await wait("document.querySelector('.draft-caption')?.textContent.includes('准备暂存内容')");
      await execute("document.querySelector('.draft-caption button').click()");
      // Keep the original preparation unresolved: cancellation must release the UI now.
      await wait(
        "!document.querySelector('.draft-caption') && !document.querySelector('.generate-commit-button').disabled",
      );
      assert.deepEqual(requests, ['repo-b.ts']);
      assert.equal(
        await execute("document.querySelector('#commit-message').value"),
        '人工草稿 repo-a',
      );
      const retry = await clickGenerate();
      await entered(3);
      await wait("document.querySelector('.draft-caption')?.textContent.includes('准备暂存内容')");
      holds[1].resolve();
      await settled(cancelledPreparation);
      assert.equal(
        await execute(
          "document.querySelector('.generate-commit-button').disabled && document.querySelector('.draft-caption')?.textContent.includes('准备暂存内容')",
        ),
        true,
      );
      assert.deepEqual(requests, ['repo-b.ts']);
      holds[2].resolve();
      await settled(retry);
      await wait("document.querySelector('#commit-message').value === 'feat: 生成 repo-a.ts'");
      await ready();
      assert.deepEqual(requests, ['repo-b.ts', 'repo-a.ts']);
      console.log(
        'PASS: preparation cancellation releases UI immediately; late old task cannot send a request or clear the newer task; retry completes.',
      );

      const failedPreparation = await clickGenerate();
      await entered(4);
      await wait("document.querySelector('.draft-caption')?.textContent.includes('准备暂存内容')");
      await execute("document.querySelector('.draft-caption button').click()");
      await ready();
      const retryAfterFailure = await clickGenerate();
      await entered(5);
      holds[3].reject(new Error('late-cancelled-preparation-failure'));
      await settled(failedPreparation);
      assert.equal(
        await execute(
          "document.querySelector('.generate-commit-button').disabled && document.querySelector('.draft-caption')?.textContent.includes('准备暂存内容')",
        ),
        true,
      );
      assert.equal(
        await execute(
          "document.querySelector('.commit-generation-feedback').textContent.includes('late-cancelled')",
        ),
        false,
      );
      holds[4].resolve();
      await settled(retryAfterFailure);
      await ready();
      assert.deepEqual(requests, ['repo-b.ts', 'repo-a.ts', 'repo-a.ts']);
      console.log('PASS: late preparation failure cannot replace feedback or reset a retry.');

      reviews.commitMessages.prepare = originalPrepare;
      generationGate = { ...Promise.withResolvers(), entered: Promise.withResolvers() };
      const switchedGeneration = await clickGenerate();
      await generationGate.entered.promise;
      await select('repo-b');
      await execute(`(() => {
        const input = document.querySelector('#commit-message');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '新仓库人工草稿');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await clickGenerate();
      await wait("document.querySelector('#commit-message').value === 'feat: 生成 repo-b.ts'");
      generationGate.resolve();
      await settled(switchedGeneration);
      assert.equal(reviews.commitMessages.running.has(a.id), false);
      await ready();
      assert.equal(
        await execute("document.querySelector('#commit-message').value"),
        'feat: 生成 repo-b.ts',
      );
      assert.deepEqual(requests, ['repo-b.ts', 'repo-a.ts', 'repo-a.ts', 'repo-a.ts', 'repo-b.ts']);
      console.log(
        'PASS: switching repositories during an already-sent generation leaves the new repository independent and ignores the old result.',
      );
    } finally {
      generationGate?.resolve();
      for (const gate of holds) gate.resolve();
      window.destroy();
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.exit(process.exitCode || 0));
