# Lessons

## IP & Dependency Decisions

- 2026-10-19, MouseMux: keep CoLaB's user-to-cursor mapping and gesture integration original. Reuse the repository's existing MIT-licensed `ws` transport for the documented protocol. Do not copy vendor SDK/decompiled implementation or link undocumented internal x86 hooks into the x64 application. Match raw wire messages against the installed build because SDK callback fields may be synthesized by its JavaScript wrapper.
