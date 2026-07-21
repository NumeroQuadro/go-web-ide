# Security Policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature in the repository's **Security** tab. Include the affected component, reproduction steps, impact, and any suggested mitigation.

Do not publish exploit details, credentials, or sensitive deployment information in a public issue. If private reporting is temporarily unavailable, open a minimal issue asking the maintainers for a private contact channel.

## Deployment responsibility

This project executes Go code in Docker containers, but containerization is not a complete security boundary. Operators are responsible for host hardening, network isolation, resource limits, patching, secret rotation, and access control. The internal runner should remain bound to a loopback address and must never be exposed directly to the internet.
