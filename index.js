const { marked } = require('marked');
const fs = require('fs');
const { join, extname, basename, dirname } = require('path');
const { program } = require('commander');
const Handlebars = require("handlebars");
const stylus = require('stylus');

program
	.option('-p, --path [path]')
	.option('-o, --output [path]')

program.parse();

const options = program.opts();

console.log(options);

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
	getTemplates(join(path, 'partials/'))
		.forEach((file) => {
			var data = fs.readFileSync(file, 'utf8');
			var name = basename(file, '.hbs');
			Handlebars.registerPartial(name, data);
		});

	let langs = parseLangs(join(path, 'texts/'));
	console.log("Detected languages: " + langs);

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
