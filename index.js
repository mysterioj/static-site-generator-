const { prepare, diff, apply } = require('@dldc/rsync');
const Jimp = require("jimp");
const { HtmlValidate } = require('html-validate');
const watch = require('watch');
const { tidy } = require('htmltidy2')
const log = require("log");
const { marked } = require('marked');
const fs = require('fs');
const { join, extname, basename, dirname } = require('path');
const { program } = require('commander');
const Handlebars = require("handlebars");
const stylus = require('stylus');
const YAML = require('yaml');

program
	.command('init <path>')
	.action(path => {
		process.env['LOG_LEVEL'] = 'info';
		tryIgnoreEEXIST(() => fs.mkdirSync(join(path, 'out')));
		tryIgnoreEEXIST(() => fs.mkdirSync(join(path, 'src')));
		tryIgnoreEEXIST(() => fs.mkdirSync(join(path, 'src/texts/')));
		tryIgnoreEEXIST(() => fs.mkdirSync(join(path, 'src/pages/')));
		tryIgnoreEEXIST(() => fs.mkdirSync(join(path, 'src/resources/')));
		tryIgnoreEEXIST(() => fs.mkdirSync(join(path, 'src/texts/en/')));
		tryIgnoreEEXIST(() => fs.mkdirSync(join(path, 'src/partials/')));
		tryIgnoreEEXIST(() => fs.mkdirSync(join(path, 'src/styl/')));
		tryIgnoreEEXIST(() => fs.writeFileSync(
			join(path, 'src/partials/basis.hbs'), 
			`
<html>
	<head>
		{{#>dependencies}}
		{{/dependencies}}
	</head>
	<body>
		{{>content}}
	</body>
</html>
			`
		));
		tryIgnoreEEXIST(() => fs.writeFileSync(
			join(path, 'src/index.hbs'), 
			`
{{#*inline "dependencies"}}
<link rel="stylesheet" href="/style.css" />
{{/inline}}
{{#*inline "content"}}
<h1>{{>texts.hello}}</h1>
{{/inline}}
{{>basis}}
			`
		));
		tryIgnoreEEXIST(() => fs.writeFileSync(
			join(path, 'src/styl/style.styl'),
			`
body
	margin: 0
			`
		));
		tryIgnoreEEXIST(() => fs.writeFileSync(
			join(path, 'src/texts/en/hello.html'),
			`
Hello world
			`
		));
		console.log('Successfully initialized website at %s', path);
	});

let compile = false;

program
	.command('compile', { isDefault: true })
	.action(() => { 
		compile = true;
	});

program
	.option('-p, --path path', 'set path to compile templates at', './')
	.option('-o, --output path', 'set path to save compiled pages at', './out')
	.option('-s, --sync', 'only sync resources')
	.option('-w, --watch', 'watch for changes in css and resources')
	.option('-q, --quiet', 'suppress non-error messages')
	.option('-v, --verbose', 'increase verbosity')

program.parse();

if (!compile) {
	return;
}

const options = program.opts();

if (!options.quiet) {
	process.env['LOG_LEVEL'] = 'info';
}

if (options.verbose) {
	process.env['LOG_LEVEL'] = 'debug';
}

require("log-node")();


let config;
let input;
try {
	input = fs.readFileSync('./config.yml', 'utf8');
} catch (err) {
	switch (err.code) {
		case 'ENOENT':
			try {
				input = fs.readFileSync('./config.json', 'utf8');
			} catch (err) {
				switch (err.code) {
					case 'ENOENT':
						log.error('Unable to open config: file not found');
						break;
					default:
						log.error(`Unable to open config: ${err.message}`);
				}
				return;
			}
			break;
		default:
			log.error(`Unable to open config: ${err.message}`);
			return;
	}
}
if (input) {
	try {
		config = YAML.parse(input);
	} catch (err) {
		log.error(`Cannot parse YAML\n${err.name}: "${err.message}"`);
		return;
	}
} else {
	log.info('Config is empty');
}

try {
	checkConfig(config);
} catch (err) {
	log.error(err);
	return;
}

config = setConfigDefaults(config);


var out;

if (process.env['COMPILE_OUTPUT'] == undefined) {
	out = options.output;
} else {
	out = process.env['COMPILE_OUTPUT'];
}

if (!out.endsWith('/')) {
	out = out+'/';
}

var path;


if (process.env['COMPILE_PATH'] == undefined) {
	path = options.path;
} else {
	path = process.env['COMPILE_PATH'];
}

if (!path.endsWith('/')) {
	path = path+'/';
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}   

if (options.watch) {
	log.info("Starting path watch");
	log.info(path);
	watch.watchTree(join(path, 'resources'), { interval: 1 }, function(f, p, c) {
		if (c == null) {
			return;
		}
		if (!options.quiet) {
			process.env['LOG_LEVEL'] = 'info';
		}
		if (options.verbose) {
			process.env['LOG_LEVEL'] = 'debug';
		}
		log.info("Resource sync...");
		syncResources(join(path, 'resources'), out);
	});
	watch.watchTree(join(path, 'styl'), { interval: 1}, function(f, p, c) {
		if (c == null) {
			return;
		}
		if (!options.quiet) {
			process.env['LOG_LEVEL'] = 'info';
		}
		if (options.verbose) {
			process.env['LOG_LEVEL'] = 'debug';
		}
		log.info("Compile css...");
		compileCss(join(path, 'styl'), out, config?.css.ignore);
	});
	return;
}


if (options.sync === true) {
	log.info("Resource sync...");
	syncResources(join(path, 'resources'), out);
	log.info("Done");
	return;
}


try {
	fs.mkdirSync('out');
} catch(err) {
	if (err.code != 'EEXIST') {
		log.error(`Unable to create out dir: ${err.message}`);
		return;
	}
}

try {
	fs.mkdirSync('.tmp/texts', { recursive: true });
} catch(err) {
	if (err.code != 'EEXIST') {
		log.error(`Unable to create temp dir: ${err.message}`);
		return;
	}
}

try {
	let partials = getTemplates(join(path, 'partials/'));
	if (Array.isArray(config?.extra_partials)) {
		let extra = config?.extra_partials
			.flatMap((path) => getTemplates(path));
		partials.push.apply(partials, extra);
	}
	partials
		.forEach((file) => {
			var data = fs.readFileSync(file, 'utf8');
			var name = basename(file, '.hbs');
			Handlebars.registerPartial(name, data);
		});

	let langs;
	if (!config.i18n) {
		langs = [];
	} else {
		langs = parseLangs(join(path, 'texts/'));
		if (langs.length == 0) {
			log.error("No languages detected");
			return;
		} else {
			log.info("Detected languages: " + langs);
		}
	}

	langs.forEach((lang) => {
		log.info(`Processing language "${lang}"`);
		var texts_count = registerTexts(join(path, join('texts', lang)));
		log.info(`Found ${texts_count} texts`);

		let preset;
		if (config?.validate_html) {
			switch (config?.validate_html.preset) {
				case 'strict':
					preset = ["html-validate:recommended"];
					break;
				default:
					preset = ["html-validate:standard"];
					break;
			}
		} else {
			preset = [];
		}
		const htmlvalidate = new HtmlValidate(
			{ extends: preset }
		);

		var count = getTemplates(path)
			.filter((file) => !file.includes('partials'))
			.map((file) => {
				var data = fs.readFileSync(file, 'utf8');
				let compiled;
				try {
					const template = Handlebars.compile(data);
					var data = { lang: lang };
					compiled = template(data);
				} catch(err) {
					let p = file.replace(path, "");
					let e = `Unable to compile template "${p}": ${err.message}`;
					if (config?.abort_on_error) {
						throw e;
					} else {
						log.error(e);
					}
					return true;
				}
				if (out == undefined) {
					console.log(compiled);
				} else {
					var p = join(join(out, lang), file
						.replace(path, '')
						.replace('pages', '')
						.replace(extname(file), '.html'));
					try {
						fs.mkdirSync(dirname(p), { recursive: true });
					} catch(err) {
						const error = `Unable to create output dir for page ${file}: ${err.message}`;
						if (err.code != 'EEXIST' && config?.abort_on_error) {
							throw error;
						} else {
							log.error(error);
						}
					}
					tidy(compiled, { indent: true }, async function(e, html) {
						if (!options.quiet) {
							process.env['LOG_LEVEL'] = 'info';
						}
						if (options.verbose) {
							process.env['LOG_LEVEL'] = 'debug';
						}
						if (e != '') {
							log.error(e);
						}
						if (config?.validate_html) {
							const report = await htmlvalidate.validateString(html);
							const rel_path = file.replace(path, '');
							log.warn(
								'%s warnings for page "%s":',
								report.results[0].messages.length,
								p.replace(out, '')
							);
							report.results[0].messages
								.forEach((m) => {
									log.warn('warning at line %s: %s', m.line, m.message);
								});
						}
						try {
							fs.writeFileSync(p, html);
						} catch(err) {
							const error = `Unable to write page ${file}: ${err.message}`;
							if (config?.abort_on_error) {
								throw error;
							} else {
								log.error(error);
							}
						}
					});
				}
				return false;
			})
			.reduce((res, err) => {
				if (err) {
					res.errors++;
				} else {
					res.pages++;
				}
				return res;
			}, { pages: 0, errors: 0 });
		log.info(`Compiled ${count.pages} page(s) with ${count.errors} error(s)`);
	});
	log.info("Resource sync...");
	syncResources(join(path, 'resources'), out);
	log.info("Done");
	if (config?.css) {
		log.info("Compile css...");
		compileCss(join(path, 'styl'), out, config?.css.ignore);
		log.info("Done");
	}
	log.info("Resize media...");
	// resizeMedia(join(out, 'img'));
	log.info("Done");
} catch (err) {
    log.error(err);
    return;
}

function syncResources(res, out) {
	let files = getFilesRecursive(res)
		.forEach((f) => {
			const input = fs.readFileSync(f);
			const destFile = f.replace(res, out).replace("//", "/");
			let dest;
			if (fs.existsSync(destFile)) {
				dest = fs.readFileSync(destFile);
			} else {
				dest = [];
				fs.mkdirSync(dirname(destFile), { recursive: true });
				fs.writeFileSync(destFile, input);
				return;
			}
			const checksum = prepare(destFile); 
			const patches = diff(input, checksum);
			fs.mkdirSync(dirname(destFile), { recursive: true });
			const syncedFile = apply(destFile, patches);	
			fs.writeFileSync(destFile, Buffer.from(syncedFile));
		});
}

function compileCss(path, out, ignore) {
	let files = getFilesRecursive(path)
		.filter((f) => {
			const dir = dirname(f).replace(path, '').replace('/', '').trim();
			return ignore == undefined || !ignore.includes(dir);
		})
		.forEach((f) => {
			const destFile = f
				.replace(path, join(out, 'css'))
				.replace('//', '/')
				.replace(extname(f), '.css');
			const input = fs.readFileSync(f, 'utf8');
			stylus(input)
				.include(path)
				.set('filename', basename(f))
				.render(function(err, css) {
					if (err) throw `Error compiling css file ${f}: ${err.message}`;
					fs.mkdirSync(dirname(destFile), { recursive: true });
					fs.writeFileSync(destFile, css);
				});
		});
}

function registerTexts(path) {
	return getMarkdown(path).map((file) => {
			var data = fs.readFileSync(file, 'utf8');
			return ({ file, data: marked.parse(data) });
		})
		.concat(getHtml(path)
			.map((file) => ( { file, data: fs.readFileSync(file, 'utf8') }))
		)
		.map(({ file, data }) => {
			return { 
				file: file.replace(path, '').replace(extname(file), ''),
				data
			}
		})
		.map(({ file, data }) => {
			const partialName = join('texts', file).replaceAll('/', '.');
			Handlebars.registerPartial(partialName, data);
		})
		.length;
}

function getMarkdown(path) {
	return getFilesRecursive(path)
		.filter((path) => extname(path) == '.md');
}

function getHtml(path) {
	return getFilesRecursive(path)
		.filter((path) => extname(path) == '.html');
}

function getTemplates(path) {
	return getFilesRecursive(path)
		.filter((path) => extname(path) == '.hbs');
}

function getFilesRecursive(path) {
	var files = fs.readdirSync(path, { withFileTypes: true });
	const result = files.flatMap((entry) => {
		let p = join(path, entry.name);
		if (fs.lstatSync(p).isDirectory()) {
			var t = getFilesRecursive(p);
			return t;
		}
		if (fs.lstatSync(p).isFile()) {
			return p;
		}
	});
	return result;
}

function parseLangs(path) {
	var files = fs.readdirSync(path);
	return files
		.filter((file) => fs.lstatSync(join(path, file)).isDirectory())
		.map((dir) => dir)
}

function setConfigDefaults(config) {
	if (config == undefined) {
		config = {};
	}
	if (config.css === undefined) {
		config.css = true;
	}
	if (config.i18n === undefined) {
		config.i18n = true;
	}
	return config;
}

function checkConfig(config) {
	if (config?.extra_partials !== undefined && !Array.isArray(config.extra_partials)) {
		throw 'Extra partials must contain array of paths';
	}
	if (config?.css?.ignore !== undefined && !Array.isArray(config.css.ignore)) {
		throw 'Ignored css directories must contain array of paths';
	}
	switch (config?.validate_html?.preset) {
		case undefined:
		case 'standard':
		case 'strict':
			break;
		default:
			throw `Invalid validate html preset: ${config.validate_html.preset}`;
	}
	return;
}

function resizeMedia(path) {
	if (!fs.existsSync(path)) {
		return
	}
	const media = getFilesRecursive(path);
	media
		.filter((file) => extname(file) == '.png' || extname(file) == '.jpg')
		.forEach((file) => {
			const output = file
				.replace(extname(file), '_480'+extname(file));
			if (fs.existsSync(output)) {
				return;
			}
			console.log(file);
			Jimp.read(file)
				.then((file) => {
					return file 
						.scaleToFit(960, 480)
						.write(output);
				});
		});
}

function tryIgnoreEEXIST(fn) {
	try {
		fn();
	} catch (err) {
		if (err.code != 'EEXIST') {
			throw err
		}
	}
}
