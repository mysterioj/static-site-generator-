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
	getMarkdown(join(path, 'texts/'))
		.map((file) => {
			var data = fs.readFileSync(file, 'utf8');
			var html = marked.parse(data);
			var tmpPath = file.replace(join(path, 'texts/'), '');
			tmpPath = tmpPath.replace(extname(tmpPath), '');
			var partialName = 'texts.'+tmpPath.replace(extname(file), '')
				.replaceAll('/', '.');
			Handlebars.registerPartial(partialName, html);
		});
	getHtml(join(path, 'texts/'))
		.map((file) => {
			var html = fs.readFileSync(file, 'utf8');
			var tmpPath = file.replace(join(path, 'texts/'), '');
			tmpPath = tmpPath.replace(extname(tmpPath), '');
			var partialName = join('texts', tmpPath.replace(extname(file), ''))
				.replaceAll('/', '.');
			Handlebars.registerPartial(partialName, html);
		});
	getTemplates(join(path, 'partials/'))
		.map((file) => {
			var data = fs.readFileSync(file, 'utf8');
			var name = basename(file, '.hbs');
			Handlebars.registerPartial(name, data);
		});
	getTemplates(join(path, 'pages/'))
		.map((file) => {
			var data = fs.readFileSync(file, 'utf8');
			const template = Handlebars.compile(data);
			var data = "{}";
			const compiled = template(data);
			if (options.output == undefined) {
				console.log(compiled);
			} else {
				var p = options.output+file
					.replace(join(path,'pages'), '')
					.replace(extname(file), '.html');
				try {
					fs.mkdirSync(dirname(p), { recursive: true });
				} catch(err) {}
				fs.writeFileSync(p, compiled);
			}
		});
} catch (err) {
    console.error(err);
    return;
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
