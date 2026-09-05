# Publishing

The `CI/CD` GitHub Actions workflow validates and packages every push and pull request. A push of a version tag also publishes the exact tested VSIX to the Visual Studio Marketplace through OpenID Connect (OIDC).

## One-time trusted-publishing setup

1. In the GitHub repository settings, create an environment named `vscode-marketplace`. Add required reviewers if releases should require manual approval.
2. In the Visual Studio Marketplace publisher portal for publisher `RavidAmar`, configure a trusted-publishing policy for:
   - GitHub organization or user: `Ravid-Amar`
   - Repository: `VS-Code-Resource-Monitor`
   - Workflow: `.github/workflows/nodejs.yml`
   - Environment: `vscode-marketplace`
3. Do not add a Marketplace token to the repository. The publish job requests a short-lived credential for each tagged release and cannot run for pull requests.

## Release procedure

1. Update the version in both `package.json` and `package-lock.json`.
2. Add the release notes to `CHANGELOG.md`.
3. Run the local checks:

   ```bash
   npm ci
   npm run lint
   npm test
   npm run verify:data
   ```

4. Commit and push the release changes.
5. Create and push a matching version tag. For version `1.0.17`, the tag must be `v1.0.17`:

   ```bash
   git tag -a v1.0.17 -m "System Metrics Lens 1.0.17"
   git push origin master --follow-tags
   ```

The build job rejects a tag that does not exactly match the version in `package.json`. It uploads the packaged VSIX as a workflow artifact. The publish job downloads that same artifact and publishes it only after the build succeeds.

## Failed releases

- If validation or packaging fails, fix the source and create a new patch version and tag.
- If publishing fails before the Marketplace accepts the version, correct the trusted-publishing configuration and rerun the failed job.
- If the Marketplace already accepted the version, never reuse it for different code; increment the patch version and create a new tag.
