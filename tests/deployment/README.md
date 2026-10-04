# Deployment tests

`local*.test.ts` exercises the documented local launcher with real UI, API, and worker processes.
It covers owner sessions, loopback readiness, signal cleanup, paths containing spaces, and
preflight failures that must not leave child processes behind.
