<img src="https://raw.githubusercontent.com/IanSSenne/mcbuild/master/assets/MCB%20Title%20B.png" alt="MCB Banner"/>

## need help?

feel free to come ask for help in the mc-build discord https://discord.gg/kpGqTDX or read the docs at https://github.com/mc-build/mcb/wiki

# mc-build

mc-build is a cli tool that helps with the creation of data packs through compiling a custom format to functions.

## cli

| command     | result                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `mcb`       | will show the help for the command line                                                                                     |
| `mcb build` | will cause mc-build to run a single build of the project and then exit, also sets the build flag in the js config to `true` |

## installation

### prerequisites

mc-build runs on nodejs, if you don't already have it you can get it at https://nodejs.org

### yarn

```bash
$ yarn global add mc-build
```

### npm

```bash
$ npm i -g mc-build
```

### documentation

[https://github.com/mc-build/mcb/wiki](https://github.com/mc-build/mcb/wiki)

### NOTES:

the require call in script block does not have a test case as the testing enviroment does not provide full file paths as the `Module.createRequire` call expects

**I as well as the mc-build project am not affiliated with Mojang in any way.**
