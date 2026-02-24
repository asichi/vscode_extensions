# VS Code Extensions

A collection of custom VS Code extensions by Anthony Siciliano.

## Extensions

### 🔧 C# Formatter Extension

A C# code formatter that enforces modern C# conventions and organizes your code structure.

**Features:**

- Converts block namespaces (`namespace X { }`) to file-scoped namespaces (`namespace X;`)
- Moves namespace declarations to the top of the file
- Sorts `using` statements intelligently
  - Prioritizes `System.*` namespaces
  - Removes redundant `using System;` when `System.*` usings exist
  - Optional grouping by namespace prefix
  - Preserves using aliases separately
- Removes duplicate using statements

**Location:** `csformatter-extension/`

---

## Development

Each extension is in its own folder with its own `package.json` and dependencies.

## License

MIT
