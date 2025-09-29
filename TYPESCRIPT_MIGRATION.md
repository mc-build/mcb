# TypeScript Migration Status

This project has been partially migrated from Haxe to TypeScript.

## ✅ Completed Components

- **CLI Interface** (`src-ts/mcb/cli.ts`) - Complete TypeScript implementation using Commander.js
- **Pack Creation** (`src-ts/mcb/app-main.ts`) - Full pack creation functionality with template rendering
- **Logger** (`src-ts/mcb/logger.ts`) - Console logging with chalk for colors
- **Build System** - TypeScript compilation pipeline with `build-ts.sh`
- **Project Structure** - TypeScript configuration, dependencies updated

## ⏳ Working CLI Commands

- `mcb create <pack-name>` - ✅ **FULLY WORKING** - Creates new MCB packs with proper templates
- `mcb build` - ⚠️ **PARTIALLY WORKING** - Shows helpful status info, but doesn't compile MCB files yet
- `mcb watch` - ⚠️ **STUB** - Shows warning message
- `mcb generate <file>` - ⚠️ **STUB** - Shows warning message
- `mcb venv setup/activate` - ⚠️ **STUB** - Shows warning message

## 🔄 Components Still Need Migration

The following core components are still in Haxe and need to be migrated to TypeScript:

### Critical Components
- **MCL Tokenizer** (`src/mcl/Tokenizer.hx`) - Parses MCB syntax into tokens
- **MCL Parser** (`src/mcl/Parser.hx`) - Converts tokens into AST
- **MCL Compiler** (`src/mcl/Compiler.hx`) - Compiles AST to Minecraft commands
- **AST Nodes** (`src/mcl/AstNode.hx`) - Abstract syntax tree definitions
- **Template System** (`src/mcl/TemplateRegisterer.hx`) - MCB template processing

### Supporting Components
- **IO System** (`src/Io.hx`) - File input/output handling
- **Library Store** (`src/mcl/LibStore.hx`) - MCB library management  
- **Tag Manager** (`src/mcl/TagManager.hx`) - Minecraft tag management
- **Config System** (`src/mcl/Config.hx`) - Configuration management
- **Error Handling** (`src/mcl/error/*.hx`) - Error types and handling
- **Template Arguments** (`src/mcl/args/*.hx`) - Template argument types

### Optional Components  
- **Virtual Environment** (`src/mcb/venv/*.hx`) - Version management
- **Test Suite** (`src/testbed/*.hx`) - Testing framework
- **String Utils** (`src/strutils/StringUtils.hx`) - String utilities

## 🚀 Current Capabilities

The TypeScript version can:
- Create new MCB packs with proper structure and templates
- Fetch latest Minecraft version data
- Show informative status messages
- Handle CLI arguments properly
- Provide clear migration status

## 📋 Next Steps for Full Migration

1. **Migrate Core Parser Pipeline**
   - Tokenizer: Convert MCB syntax to tokens
   - Parser: Build AST from tokens
   - Basic AST node types

2. **Migrate Compiler Core**
   - AST compilation to Minecraft commands
   - File output system
   - Basic template support

3. **Add File Processing**
   - IO system for reading/writing files
   - Directory traversal for MCB files
   - Build pipeline integration

4. **Migration Testing**
   - Test against existing MCB projects
   - Ensure output compatibility
   - Performance benchmarking

## 🔨 Build System

- **Development**: `yarn dev` (TypeScript watch mode)
- **Production**: `yarn build` (Full build with templates)
- **TypeScript Only**: `yarn build:ts-only` (Just compile TS)

## 📁 File Structure

```
src-ts/           # TypeScript source code
├── main.ts       # CLI entry point
├── mcb/          # Main MCB functionality
│   ├── cli.ts    # Command line interface
│   ├── app-main.ts # Core application logic
│   ├── logger.ts # Logging utilities
│   └── venv/     # Virtual environment (stub)
└── mcl/          # MCL compiler (stubs)
    ├── compiler.ts
    ├── lib-store.ts
    └── error/
        └── mcb-error.ts

dist/             # Compiled JavaScript output
├── main.js       # Executable CLI
├── template/     # Pack templates
└── .mcblib/      # MCB libraries
```

The original Haxe code remains in `src/` for reference during migration.