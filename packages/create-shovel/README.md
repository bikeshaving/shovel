# create-shovel

Scaffold a new [Shovel](https://github.com/bikeshaving/shovel) project.

## Usage

```bash
npm create shovel
```

Or with a project name:

```bash
npm create shovel my-app
```

## Options

```
--template <name>       hello-world, api, static-site, full-stack
--framework <name>      vanilla, htmx, alpine, crank
--jsx / --no-jsx        Use JSX syntax (Crank only)
--typescript / --no-typescript
--platform <name>       node, bun, cloudflare
```

Skip all prompts:

```bash
npm create shovel my-app -- --template full-stack --framework crank --no-jsx --typescript --platform bun
```
