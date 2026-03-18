# VS Code Extensions

A collection of custom VS Code extensions by Anthony Sichi.

## Extensions

### 🔧 C# Formatter Extension

A C# code formatter that enforces modern C# conventions and organizes your code structure.

**Features:**

- Converts block namespaces (`namespace X { }`) to file-scoped namespaces (`namespace X;`)
- Moves namespace declarations to the top of the file
- Sorts `using` statements intelligently
  - Prioritizes `System.*` namespaces
  - Removes redundant `using System;` when `System.*` usings exist
  - Groups by first namespace segment (blank line between `System.*`, `DbUp.*`, `StrategyEngine.*`)
  - Preserves using aliases separately
- Removes duplicate using statements

**Location:** `csformatter-extension/`

**Build & Install:**

```bash
cd csformatter-extension

# 1. Build
npx vsce package

# 2. Uninstall from GUI

# 3. Close VS Code completely

# 4. Reopen and install via GUI (from vsix)

```

**Development Workflow:**

After making code changes, run all three commands above and restart VS Code.

---

## Development

Each extension is in its own folder with its own `package.json` and dependencies.

## License

MIT