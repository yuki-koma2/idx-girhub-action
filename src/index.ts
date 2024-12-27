import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as path from 'node:path';
import { createFolderReadme, identifyTargetSubfolder } from './generate-readme';
import { AgentProgressReport } from './progress';

go();

const COMMENT_PREAMBLE_MD = `
👋 Hey there, since you tagged this issue with the \`AutoReadme\` label,
let's see if we can generate a \`README.md\` for the directory in
this repo you're talking about.

This may take a few minutes, but I'll let you know how it goes by updating
this comment as I make progress.

---
`.trimStart();

async function go() {
  try {
    // get access to the GitHub API via Octokit
    const octokit = github.getOctokit(core.getInput('githubToken'));

    // initial setup
    let commentId = 0; // the comment we'll create and keep updated as progress is made
    let progressReport = new AgentProgressReport();
    progressReport.info('Getting started...');
    let getUpdatedIssueBody = () => COMMENT_PREAMBLE_MD + '\n' + progressReport.toMarkdown();
    progressReport.onProgressUpdated(updateComment);
    let rootFolder = process.cwd();
    let targetSubfolder = '';
    let generatedReadmePath = '';

    async function updateComment() {
      if (!commentId) return;
      await octokit.rest.issues.updateComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        comment_id: commentId,
        body: getUpdatedIssueBody()
      });
    }

    // Set up the comment
    await core.group('Creating issue comment', async () => {
      let response = await octokit.rest.issues.createComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: github.context.issue.number,
        body: getUpdatedIssueBody(),
      });
      commentId = response.data.id;
      console.log('Created comment: ' + response.data.html_url);
    });    

    await core.group('Identifying target folder', async () => {
      try {
        let response = await octokit.rest.issues.get({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          issue_number: github.context.issue.number,
        });
        targetSubfolder = await identifyTargetSubfolder(rootFolder, [
          response.data.title,
          response.data.body || '',
        ].join(' '));
        progressReport.info('I think you mean this folder: ' + path.relative(rootFolder, targetSubfolder))
      } catch (e) {
        progressReport.error((e as any)?.message);
        core.setFailed((e as any)?.message);
        throw e;
      }
    });
  
    await core.group('Generating README for folder', async () => {
      try {
        generatedReadmePath = await createFolderReadme(targetSubfolder, progressReport);
      } catch (e) {
        progressReport.error(`Error generating README: ${(e as any)?.message}`);
        core.setFailed((e as any)?.message);
        throw e;
      }
    });
  
    await core.group('Creating pull request', async () => {
      // create local branch and push it
      const branchId = `issue${github.context.issue.number}-readme`;
      progressReport.info(`Creating branch \`${branchId}\` and pull request...`);
      await exec.exec('git', ['config', '--global', 'user.email', 'test@example.com']);
      await exec.exec('git', ['config', '--global', 'user.name', 'Hello world agent']);
      await exec.exec('git', ['checkout', '-b', branchId]);
      await exec.exec('git', ['add', generatedReadmePath]);
      await exec.exec('git', ['commit', '-m', `Create README for ${path.relative(rootFolder, targetSubfolder)}`]);
      try {
        await exec.exec('git', ['push', 'origin', ':' + branchId]); // delete existing branch if exists
      } catch { }
      await exec.exec('git', ['push', 'origin', branchId]);
      // create pull request
      let response = await octokit.rest.pulls.create({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        base: 'main',
        head: branchId,
        title: `Create README for ${path.relative(rootFolder, targetSubfolder)}`,
        body: `As requested in issue #${github.context.issue.number}`
      });
      let pullRequestUrl = response.data.html_url;
      progressReport.info(`[Pull request #${response.data.id}](${pullRequestUrl}) created!`);
    });

    progressReport.status = 'done';

  } catch (e) {
    core.setFailed((e as any)?.message);
  }
}