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

var path;

if (options.first == undefined) {
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
			tmpPath = tmpPath.replace(extname(tmpPath), '.hbs');
			var partialName = 'texts.'+basename(file).replace(extname(file), '')
				.replace('/', '.');
			Handlebars.registerPartial(partialName, html);
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

function getTemplates(path) {
	return getFilesRecursive(path)
		.filter((path) => extname(path) == '.hbs');
}

function getFilesRecursive(path) {
	var files = fs.readdirSync(path, { withFileTypes: true });
	var result = [];
	for (const entry of files) {
		if (entry.isDirectory()) {
			result = result.concat(getTemplates(join(path, entry.name)));
		}
		if (entry.isFile()) {
			result.push(join(path, entry.name));
		}
	}
	return result;
}
