# Generate README for a directory - GitHub Action

## Background

As part of exploring what it’s like to build agents in IDX, I set out to build a “Generate README file for a given directory in my code” agent that would be deployed as a GitHub action. The behavior of the action is:

- User creates an issue in your GitHub repo describing the task, like “We need docs for the examples folder”
- User adds a label `AutoReadme`` to their issue
- The GitHub action then goes off and generates the README as a pull request, leaving a comment on your issue that gets updated as the agent makes progress on analyzing your task and preparing the pull request

## Note about this repository

Note that this repo includes both:

- The core agent code (`action.yml`, `src` folder, etc)
- A test environment for the agent itself (see the `.github/workflows` and `example-directory` folders)