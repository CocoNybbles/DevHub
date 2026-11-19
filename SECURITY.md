# Security

## Reporting a vulnerability

Please **do not open a public issue**. Report vulnerabilities confidentially via
["Report a vulnerability"](https://github.com/CocoNybbles/DevHub/security/advisories/new)
("Security" tab of the repository).

Helpful details:

- affected version (see [Releases](https://github.com/CocoNybbles/DevHub/releases))
- description and impact of the vulnerability
- steps to reproduce

You will get a reply as soon as the report has been reviewed. Fixed vulnerabilities are shipped
with a new release.

## Supported versions

Security fixes are only provided for the [latest version](https://github.com/CocoNybbles/DevHub/releases/latest).

## Notes

- DevHub starts the locally installed Claude Code with the rights of the signed-in Windows user.
  Agents can change files and run commands in their project folder – just like Claude Code itself.
- The agents' back channel to the app only listens on `127.0.0.1` and is protected by a random token.
