# Publishing

The `CI/CD` GitHub Actions workflow validates and packages every push and pull request. A push of a version tag also publishes the exact tested VSIX to the Visual Studio Marketplace using a Personal Access Token stored as an encrypted GitHub Actions secret.

## One-time publishing setup

1. Create an Azure DevOps Personal Access Token that can publish extensions for Marketplace publisher `RavidAmar`. Grant only the Marketplace management scope required by `vsce`.
2. Open the GitHub repository's **Settings → Secrets and variables → Actions** page.
3. Create a repository secret named `VSCE_PAT` and paste the token as its value. Never commit or paste the token into an issue, log, workflow, or source file.

The secret is exposed only to the tag-restricted publish job. Pull-request workflows cannot publish and do not receive the token.

> Azure DevOps global PATs are scheduled for retirement on December 1, 2026. Replace this setup with Microsoft Entra ID or Marketplace trusted publishing when the required publisher UI becomes available.

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
- If publishing fails before the Marketplace accepts the version, correct or replace the `VSCE_PAT` secret and rerun the failed job.
- If the Marketplace already accepted the version, never reuse it for different code; increment the patch version and create a new tag.
