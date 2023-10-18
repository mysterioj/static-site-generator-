This project is a static website generator

# Features

- [x] Inject md and html text into templates
- [x] Multi-lingual texts
- [x] Config
- [ ] Tidy html
- [ ] Resource syncing
- [ ] Media resizing


# Configuration reference

In order to configure generator, create file `config.json` in directory you are
working in. 

Available properties:

- i18n - `bool`  
    Set it to `false` in order to disable multilingual site generation.  
    Default: `true`
- extra\_partials - `Array`  
    List directories in which to scan for extra partials.   
    Default: `undefined`
