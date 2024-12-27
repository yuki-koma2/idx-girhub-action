import { GoogleGenerativeAI } from "@google/generative-ai";
import { isText } from 'istextorbinary';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { GEMINI_API_KEY } from './config';
import { FIND_TARGET_FOLDER_PROMPT, GENERATE_README_PROMPT, SUMMARIZE_FILE_PROMPT } from './prompts';
import { AgentProgressReport } from "./progress";

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

const MAX_TEXT_FILES = 30;

const MAX_IDENTIFY_SUBFOLDERS = 30;
const IGNORE_IDENTIFY_SUBFOLDERS = [
  '.git',
  'node_modules',
]

/**
 * Uses AI to identify which subfolder the user is referring to in a given text prompt.
 */
export async function identifyTargetSubfolder(rootFolder: string, prompt: string) {
  // Collect subfolders
  let subfolders = await collectSubfolders(rootFolder);

  // Abort if there are more than a reasonable maximum
  if (subfolders.length > MAX_IDENTIFY_SUBFOLDERS) {
    throw new Error(`For this demo, a maximum of ${MAX_IDENTIFY_SUBFOLDERS} files per folder is supported`);
  }

  let normalizeRelativePath_ = (p: string) => p.startsWith('./') ? p : `./${p}`;
  subfolders = subfolders.map(f => normalizeRelativePath_(path.relative(rootFolder, f)));

  let chosenFolder = await generateText(FIND_TARGET_FOLDER_PROMPT({
    folderList: subfolders,
    issueDetails: prompt,
  }));
  // TODO: you probably want more robust unescaping here
  chosenFolder = normalizeRelativePath_(chosenFolder.trim().replace(/^["']|["']$/g, ''));
  if (!subfolders.includes(chosenFolder)) {
    throw new Error(`Couldn't identify target folder: "${chosenFolder}"`);
  }
  return chosenFolder;
}

/**
 * A simple agent that generates a README.md for the given folder, using AI. This is a trivial agent
 * that's invoked by a user on a given folder, and calls the Gemini API to summarize the files in
 * the folder and then the summaries of all the files. It then puts this in a README.md in that
 * folder.
 */
export async function createFolderReadme(folder: string, progress: AgentProgressReport): Promise<string> {
  let readmePath = path.resolve(folder, 'README.md');

  // Collect files
  progress.info('Collecting files in this folder to summarize');
  let allFiles = await collectTargetFiles(folder);

  // See if there's already a README, if so, abort here.
  if (allFiles.includes(readmePath)) {
    throw new Error('This directory already has a README.md file');
  }

  // Filter binary files
  let textFiles = await filterOnlyTextFiles(allFiles);

  // Abort if there are more than a reasonable maximum
  if (textFiles.length > MAX_TEXT_FILES) {
    throw new Error(`For this demo, a maximum of ${MAX_TEXT_FILES} files per folder is supported`);
  }

  let errors: string[] = [];
  let fileSummaries: { filename: string, summary: string }[] = [];

  // Iteratively summarize each file
  for (let [index, file] of textFiles.entries()) {
    let relativePath = path.relative(folder, file);
    let bytes = await fs.readFile(file);
    let textContent = new TextDecoder().decode(bytes);
    progress.info(`Summarizing text file ${index + 1} of ${textFiles.length}: ${relativePath}`);
    try {
      let summary = await generateText(SUMMARIZE_FILE_PROMPT({
        filename: relativePath,
        content: textContent
      }));
      fileSummaries.push({ filename: relativePath, summary });
    } catch {
      errors.push(`File ${relativePath} couldn't be summarized`);
    }
  }

  progress.info('Summarizing the summaries');

  // Generate a README of the summaries
  let readmeContent = await generateText(GENERATE_README_PROMPT({
    folderName: path.basename(folder),
    fileSummaries,
  }));
  readmeContent = readmeContent.trim();

  // await new Promise(resolve => setTimeout(resolve, 1000));
  await fs.writeFile(readmePath, new TextEncoder().encode(readmeContent));
  progress.info(`README generated!`);
  return readmePath;
}

/**
 * Recursively lists out all subfolders for the given folder, skipping over typically ignorable ones.
 *
 * A better implementation should adhere to .gitignore
 */
async function collectSubfolders(folder: string): Promise<string[]> {
  let subfolders: string[] = [];
  for (let name of await fs.readdir(folder)) {
    if (IGNORE_IDENTIFY_SUBFOLDERS.includes(name)) {
      continue;
    }

    let itemPath = path.resolve(folder, name);
    let stat = await fs.stat(itemPath);
    if (stat.isDirectory()) {
      subfolders = [...subfolders, itemPath, ...await collectTargetFiles(itemPath)];
    }
  }

  return subfolders;
}

/**
 * Recursively lists out all files in the given folder.
 */
async function collectTargetFiles(folder: string): Promise<string[]> {
  let files: string[] = [];
  for (let name of await fs.readdir(folder)) {
    let itemPath = path.resolve(folder, name);
    let stat = await fs.stat(itemPath);
    if (stat.isDirectory()) {
      files = [...files, ...await collectTargetFiles(itemPath)];
    } else if (stat.isSymbolicLink()) {
      // skip symbolic links for now
    } else if (stat.isFile()) {
      files.push(itemPath);
    }
  }

  return files;
}

/**
 * Filters out non-text (binary) files.
 */
async function filterOnlyTextFiles(files: string[]): Promise<string[]> {
  let textFiles: string[] = [];
  for (let file of files) {
    let bytes = await fs.readFile(file);
    if (isText(file, Buffer.from(bytes))) {
      textFiles.push(file);
    }
  }
  return textFiles;
}

async function generateText(prompt: string): Promise<string> {
  console.log(prompt);
  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}