const { marked } = require('marked');
const fs = require('fs');
const { join, extname, basename, dirname } = require('path');
const { program } = require('commander');
const Handlebars = require("handlebars");
const stylus = require('stylus');

program
	.option('-p, --path [path]')
	.option('-o, --output [path]')

let config;
try {
	let input = fs.readFileSync('./config.json', 'utf8');
	if (input) {
		try {
			config = JSON.parse(input);
		} catch (err) {
			switch (err.name) {
				case 'SyntaxError': 
					console.error(`Cannot parse JSON\nSyntax error: "${err.message}"`);
					break;
				default:
					console.error(`Cannot parse JSON\n${err.name}: "${err.message}"`);
					break;
			}
			return;
		}
	} else {
		console.log('Config is empty');
	}
} catch (err) {
	switch (err.code) {
		case 'ENOENT':
			console.error('Unable to open config: file not found');
			break;
		default:
			console.error(err);
			break;
	}
	return;
}

try {
	checkConfig(config);
} catch (err) {
	console.error(err);
	return;
}

config = setConfigDefaults(config);

program.parse();

const options = program.opts();

var path;

if (options.path == undefined) {
	path = './';
} else {
	path = options.path;
}

if (!path.endsWith('/')) {
	path = path+'/';
}
try {
	fs.mkdirSync('.tmp');
	fs.mkdirSync('.tmp/texts');
} catch(err) {}

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
			console.error("No languages detected");
			return;
		} else {
			console.log("Detected languages: " + langs);
		}
	}

	langs.forEach((lang) => {
		registerTexts(join(path, join('texts', lang)));

		getTemplates(join(path, 'pages/'))
			.forEach((file) => {
				var data = fs.readFileSync(file, 'utf8');
				const template = Handlebars.compile(data);
				var data = "{}";
				const compiled = template(data);
				if (options.output == undefined) {
					console.log(compiled);
				} else {
					var p = join(join(options.output, lang), file
						.replace(join(path, 'pages'), '')
						.replace(extname(file), '.html'));
					try {
						fs.mkdirSync(dirname(p), { recursive: true });
					} catch(err) {}
					fs.writeFileSync(p, compiled);
				}
			});
	});
} catch (err) {
    console.error(err);
    return;
}

function registerTexts(path) {
	getMarkdown(path)
		.map((file) => {
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
		.forEach(({ file, data }) => {
			const partialName = join('texts', file).replaceAll('/', '.');
			Handlebars.registerPartial(partialName, data);
		});
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
	if (config.i18n === undefined) {
		config.i18n = true;
	}
	return config;
}

function checkConfig(config) {
	if (config.extra_partials !== undefined && !Array.isArray(config.extra_partials)) {
		throw 'Extra partials must contain array of paths';
	}
	return;
}
