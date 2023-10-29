const { prepare, diff, apply } = require('@dldc/rsync');
const { HtmlValidate } = require('html-validate');
const { tidy } = require('htmltidy2')
const log = require("log");
const { marked } = require('marked');
const fs = require('fs');
const { join, extname, basename, dirname } = require('path');
const { program } = require('commander');
const Handlebars = require("handlebars");
const stylus = require('stylus');

program
	.option('-p, --path path', 'set path to compile templates at', './')
	.option('-o, --output path', 'set path to save compiled pages at', './out')
	.option('-s, --sync', 'only sync resources')
	.option('-q, --quiet', 'suppress non-error messages')
	.option('-v, --verbose', 'increase verbosity')

program.parse();

const options = program.opts();

if (!options.quiet) {
	process.env['LOG_LEVEL'] = 'info';
}

if (options.verbose) {
	process.env['LOG_LEVEL'] = 'debug';
}

require("log-node")();

let config;
try {
	let input = fs.readFileSync('./config.json', 'utf8');
	if (input) {
		try {
			config = JSON.parse(input);
		} catch (err) {
			switch (err.name) {
				case 'SyntaxError': 
					log.error(`Cannot parse JSON\nSyntax error: "${err.message}"`);
					break;
				default:
					log.error(`Cannot parse JSON\n${err.name}: "${err.message}"`);
					break;
			}
			return;
		}
	} else {
		log.info('Config is empty');
	}
} catch (err) {
	switch (err.code) {
		case 'ENOENT':
			log.error('Unable to open config: file not found');
			break;
		default:
			log.error(`Unable to open config: ${err.message}`);
			break;
	}
	return;
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
	if (Array.isArray(config.extra_partials)) {
		let extra = config.extra_partials
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
		if (config.validate_html) {
			switch (config.validate_html.preset) {
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

		var count = getTemplates(join(path, 'pages/'))
			.map((file) => {
				var data = fs.readFileSync(file, 'utf8');
				let compiled;
				try {
					const template = Handlebars.compile(data);
					var data = "{}";
					compiled = template(data);
				} catch(err) {
					let p = file.replace(path, "");
					let e = `Unable to compile template "${p}":${err.message}`;
					if (config.abort_on_error) {
						throw e;
					} else {
						log.error(e);
					}
					return true;
				}
				if (out == undefined) {
					console.out(compiled);
				} else {
					var p = join(join(out, lang), file
						.replace(join(path, 'pages'), '')
						.replace(extname(file), '.html'));
					try {
						fs.mkdirSync(dirname(p), { recursive: true });
					} catch(err) {
						const error = `Unable to create output dir for page ${file}: ${err.message}`;
						if (err.code != 'EEXIST' && config.abort_on_error) {
							throw error;
						} else {
							log.error(error);
						}
					}
					tidy(compiled, { indent: true }, async function(e, html) {
						if (e != '') {
							log.error(e);
						}
						if (config.validate_html) {
							const report = await htmlvalidate.validateString(html);
							const rel_path = file.replace(path, '');
							console.warn(
								'%s warnings for page "%s":',
								report.results[0].messages.length,
								p.replace(out, '')
							);
							report.results[0].messages
								.forEach((m) => {
									console.warn('warning at line %s: %s', m.line, m.message);
								});
						}
						try {
							fs.writeFileSync(p, html);
						} catch(err) {
							const error = `Unable to write page ${file}: ${err.message}`;
							if (config.abort_on_error) {
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
	if (config.css) {
		log.info("Compile css...");
		compileCss(join(path, 'styl'), out, config.css.ignore);
		log.info("Done");
	}
} catch (err) {
    log.error(err);
    return;
}

function syncResources(res, out) {
	let files = getFilesRecursive(res)
		.forEach((f) => {
			const destFile = f.replace(res, out).replace("//", "/");
			const checksum = prepare(destFile); 
			const patches = diff(f, checksum);
			const syncedFile = apply(destFile, patches);	
		});
}

function compileCss(path, out, ignore) {
	let files = getFilesRecursive(path)
		.filter((f) => {
			const dir = dirname(f).replace(path, '').replace('/', '').trim();
			ignore != undefined && !ignore.includes(dir)
		})
		.forEach((f) => {
			const destFile = f
				.replace(path, out)
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
	if (config.css === undefined) {
		config.css = true;
	}
	if (config.i18n === undefined) {
		config.i18n = true;
	}
	return config;
}

function checkConfig(config) {
	if (config.extra_partials !== undefined && !Array.isArray(config.extra_partials)) {
		throw 'Extra partials must contain array of paths';
	}
	if (config.css?.ignore !== undefined && !Array.isArray(config.css.ignore)) {
		throw 'Ignored css directories must contain array of paths';
	}
	switch (config.validate_html?.preset) {
		case undefined:
		case 'standard':
		case 'strict':
			break;
		default:
			throw `Invalid validate html preset: ${config.validate_html.preset}`;
	}
	return;
}
