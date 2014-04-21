/*!
 * suo v0.0.1 https://github.com/dieseltravis/suo
 * All code is owned by contributors: 
 * https://github.com/dieseltravis/suo/graphs/contributors
 * Released under the MIT license: 
 * https://github.com/dieseltravis/suo/blob/master/LICENSE
 * 
 * Date: 2014-04-21
 */
/* jshint strict: true */
/*jslint passfail: false, regexp: true, plusplus: true, white: true, maxerr: 100, maxlen: 120 */
/* global Date, Math, JSON, console, require */
(function (global) {
	'use strict';

	var cfg = {
			// path configuration
			start: '.',
			source: 'files',
			app: '',
			dest: 'www',
			css: 's',
			sass: 's',
			images: 'i',
			js: 'j',
			// default data file to parse if no args passed in
			dataFile: 'data.json',
			zeroDate: new Date(2014, 1, 1),
			compress: true,
			syndicationMax: 20,
			navItemCount: 5,
			gravatar: {
				size: '32',
				design: 'retro',
				rating: 'r'
			},
			// n/a:
			fonts: 'f',
			// path functions
			path: function (trail) { return this.start + '/' + (trail || ''); },
			sourcePath: function (trail) { return this.path(this.source) + (trail || ''); },
			destPath: function (trail) { return this.path(this.dest) + (this.app || '') + (trail || ''); },
			destCss: function (trail) { return this.destPath('/' + this.css) + (trail || ''); },
			destJs: function (trail) { return this.destPath('/' + this.js) + (trail || ''); }
		},

		env = {
			now: new Date(),
			name: 'suo',
			url: 'https://github.com/dieseltravis/suo',
			version: '0.0.1'
		},

		fse = require('fs.extra'),
		async = require('async'),
		crypto = require('crypto'),
		exec = require('child_process').exec,
		uglify = require('uglify-js'),
		jsonminify = require('node-json-minify'),
		htmlminifier = require('html-minifier'),
		moment = require('moment'),
		handlebars = require('handlebars'),
		zlib = require('zlib'),
		EasyZip = require('easy-zip').EasyZip,

		handleError = function (err, name) {
			if (err) {
				console.log(name + ' error: ');
				console.log(err);
				throw err;
			}
		},
		
		getAsyncCallback = function (name, asyncCompleteCallback) {
			return function (err, results) {
				handleError(err, name);
				if (results && results.length) {
					console.log(name + ': ' + results.length + ' results');
				}
				asyncCompleteCallback(null);
			};
		},

		dataObj = {},

		// static asset copying
		getCopyAssetHandler = function (gcah_callback) {
			return function (err) {
				handleError(err, 'getCopyAssetHandler');
				gcah_callback(null);
			};
		},

		copyAssets = function (callback) {
			console.log('copying static files...');
			fse.copyRecursive(cfg.sourcePath(), cfg.destPath(), getCopyAssetHandler(callback));
		},

		// static asset versioning helpers
		// custom any base
		baseChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~-_.'.split(''),
		toBaseX = function (value) {
			var result = '',
				targetBase = baseChars.length;

			do {
				result = baseChars[value % targetBase] + result;
				value = Math.floor(value / targetBase);
			} while (value);

			return result;
		},

		// get condensed numeric date value, convert it to high based number
		shortChecksum = function (d) {
			var numericDate = +d,
				// nearest minute is accurate enough
				scale = 60 * 1000,
				// lowest date to use as a starting point
				zeroDate = +(cfg.zeroDate), 
				condensedDigit = Math.floor((numericDate - zeroDate) / scale);

			return toBaseX(condensedDigit);
		},

		fileVersionInfo = {},
		fileNameRegex = /(.+)(\.\w+)$/,
		fileNameOnlyRegex = /([^\\\/]+)$/,
		getFileDateHandler = function (path, fileName, gfdh_callback) {
			var fullFilePath = path + fileName;
			return function (err, stats) {
				handleError(err, 'getFileDateHandler');
				var chk = shortChecksum(stats.mtime),
					newFileName = fullFilePath.replace(fileNameRegex, '$1' + chk + '$2'),
					shortOld = fullFilePath.match(fileNameOnlyRegex)[1],
					shortNew = newFileName.match(fileNameOnlyRegex)[1];

				// only store filename, no path:
				console.log(shortOld + ' --> ' + shortNew);
				fileVersionInfo[shortOld] = shortNew;

				fse.rename(fullFilePath, newFileName, function (err) { handleError(err, 'fse.rename'); });
				gfdh_callback(null);
			};
		},
		fileCssRegex = /\.s?css$/i,
		getFileCssFunction = function (fileName) {
			return function (gfcf_callback) {
				fse.stat(cfg.destCss('/') + fileName, getFileDateHandler(cfg.destCss('/'), fileName, gfcf_callback));
			};
		},
		getFileVersionerCss = function(gfvc_callback) {
			return function (err, files) {
				handleError(err, 'getFileVersionerCss');
				var i, l, functions = [];
				if (files.length > 0) {
					console.log('checking ' + files.length + ' files for css...');
					for (i = 0, l = files.length; i < l; i++) {
						if (fileCssRegex.test(files[i])) {
							console.log(files[i]);
							functions.push(getFileCssFunction(files[i]));
						}
					}
					async.parallel(functions, getAsyncCallback('getFileVersionerCss', gfvc_callback));
				}
			};
		},
		fileJsRegex = /\.js$/i,
		getFileJsFunction = function (fileName) {
			return function (gfjf_callback) {
				fse.stat(cfg.destJs('/') + fileName, getFileDateHandler(cfg.destJs('/'), fileName, gfjf_callback));
			};
		},
		getFileVersionerJs = function(gfvj_callback) {
			return function (err, files) {
				handleError(err, 'getFileVersionerJs');
				var i, l, functions = [];
				if (files.length > 0) {
					console.log('checking ' + files.length + ' files for js...');
					for (i = 0, l = files.length; i < l; i++) {
						if (fileJsRegex.test(files[i])) {
							console.log(files[i]);
							functions.push(getFileJsFunction(files[i]));
						}
					}
					async.parallel(functions, getAsyncCallback('getFileVersionerJs', gfvj_callback));
				}
			};
		},

		execProcess = function (cmd, opts, ep_callback) {
			var proc = exec(cmd, opts, function (err, stdout, stderr) {
				console.log(stdout);
				if (stderr) {
					console.log('stderr: ');
					console.log(stderr);
				}
				if (err !== null) {
					console.log('exec error: ' + err);
				}
				ep_callback(null);
			});
			return proc;
		},

		fileVersioner = function (fv_callback) {
			console.log('versioning static css & js assets...');

			async.parallel([function(fv_p1_callback) {
					// for each *.scss in css
					async.series([function (fv_p1_s1_callback) {
							fse.readdir(cfg.destCss('/'), getFileVersionerCss(fv_p1_s1_callback));
						},
						function (fv_p1_s2_callback) {
							console.log('compass environment info...');
							execProcess('ruby -v', null, fv_p1_s2_callback);
						},
						//function (callback) {
						//	execProcess('gem -v', null, callback);
						//},
						function (fv_p1_s3_callback) {
							execProcess('sass -v', null, fv_p1_s3_callback);
						},
						// use compass below instead.
						//function (callback) {
						//	execProcess('sass --update . --scss -f -C --style compressed', {
						//		cwd: './www/css/'
						//	}, callback);
						//},
						function (fv_p1_s4_callback) {
							execProcess('compass -v', null, fv_p1_s4_callback);
						},
						function (fv_p1_s5_callback) {
							console.log('compass compilation...');
							execProcess('compass compile --sass-dir ' + cfg.sass + 
								' --css-dir ' + cfg.css + 
								' --images-dir ' + cfg.images + 
								' --javascripts-dir ' + cfg.js + 
								' --fonts-dir ' + cfg.fonts + 
								' -e production -s compressed --relative-assets --force', {
								cwd: cfg.destPath('/')
							}, fv_p1_s5_callback);
						},
						function (fv_p1_s6_callback) {
							console.log('removing sass cache...');
							fse.remove(cfg.destPath('/.sass-cache'), fv_p1_s6_callback);
						},
						function (fv_p1_s7_callback) {
							console.log('removing *.scss files...');
							fse.remove(cfg.destCss('/*.scss'), fv_p1_s7_callback);
						}], 
						getAsyncCallback('fileVersioner scss', fv_p1_callback));
				}, 
				function (fv_p2_callback) {
					// for each *.js in js
					async.series([function (fv_p2_s1_callback) {
							fse.readdir(cfg.destJs('/'), getFileVersionerJs(fv_p2_s1_callback));
						}, 
						function (fv_p2_s2_callback) {
							// go through whole folder? just uglify main for now
							var staticFile = cfg.destJs('/' + fileVersionInfo['main.js']),
								mainJs = uglify.minify([ staticFile ]).code;

							fse.outputFile(staticFile, mainJs, function (err) { 
								handleError(err, 'fse.outputFile'); 
								fv_p2_s2_callback(null);
							});
						}], 
						getAsyncCallback('fileVersioner js', fv_p2_callback));
				}], 
				getAsyncCallback('fileVersioner', fv_callback));
		},

		// template engine helpers

		momentHelper = function (dateTime, momentFunction) {
			dateTime = handlebars.Utils.escapeExpression(dateTime);
			momentFunction  = handlebars.Utils.escapeExpression(momentFunction);

			// RFC 1123 Pattern e.g. Thu, 10 Apr 2008 13:30:00 GMT  
			var result = (momentFunction === 'rfc1123') ?
				moment(dateTime).utc().format('ddd, DD MMM YYYY HH:mm:ss \\G\\M\\T') :
				(typeof moment()[momentFunction] === 'function') ?
				moment(dateTime)[momentFunction]() :
				moment(dateTime).format(momentFunction);
			return new handlebars.SafeString(result);
		},

		startsWithHelper = function (path, matcher) {
			path = handlebars.Utils.escapeExpression(path);
			matcher  = handlebars.Utils.escapeExpression(matcher);

			return path.indexOf(matcher) === 0;
		},

		equalsHelper = function (a, b) {
			a = handlebars.Utils.escapeExpression(a);
			b  = handlebars.Utils.escapeExpression(b);

			return a === b;
		},

		// return the first item that isn't undefined, null, or empty
		coalesceHelper = function () {
			var arg = 'error', i, l, el;
			for (i = 0, l = arguments.length; i < l; i++) {
				el = handlebars.Utils.escapeExpression(arguments[i]);
				//console.log('arguments[' + i + '] ' + arguments[i] + ' --> ' + el);
				if (el !== undefined && el !== null && el !== '') {
					arg = el;
					//console.log(arguments[i]);
					i = l + 1;
					break;
				}
			}
			/*
			var argArray = Array.prototype.slice.call(arguments),
				args = argArray.filter(function (el) {
				return el !== undefined && el !== null && el !== '';
			});
			args.shift();
			var arg = args[0] || '';
			console.log(argArray);
			arg = handlebars.Utils.escapeExpression(arg);
			*/
			return new handlebars.SafeString(arg);
		},

		// get the updated value for a static asset (css or js file)
		staticAssetHelper = function (path) {
			path = handlebars.Utils.escapeExpression(path);
			// handle scss to css confusion (key is scss)
			path = path.replace(/\.css$/i, '.scss');
			// get path if it exists
			path = (fileVersionInfo[path] || path);
			// translate scss path to css
			path = path.replace(/\.scss$/i, '.css');

			return new handlebars.SafeString(path);
		},
		
		// get gravatar icons
		gravatarHelper = function (email) {
			var urlBase = 'http://www.gravatar.com/avatar/',
				hash = crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex'),
				options = '?s=' + cfg.gravatar.size + '&d=' + cfg.gravatar.design + '&r=' + cfg.gravatar.rating;
			console.log('gravatar: email: ' + email + ', digest: ' + hash);
			return new handlebars.SafeString(urlBase + hash + options);
		},

		// template init
		templates = {},
		matchPartial = /^partial_/i,
		templateHandler = function (template, th_callback) {
			return function (err, data) {
				handleError(err, 'templateHandler');

				var dest = templates[template.id].destination;			
				templates[template.id].text = data;

				// pre-parse and cache
				templates[template.id].renderText = handlebars.compile(data);
				templates[template.id].renderDestination = handlebars.compile(dest);

				if (matchPartial.test(template.id)) {
					handlebars.registerPartial(template.id, data);
				}

				console.log('template ' + template.id + ' processed.');

				th_callback(null);
			};
		},
		getTemplateHandler = function (template) {
			return function (gth_callback) {
				var filePath = template.templateFile,
					fileHandler = templateHandler(template, gth_callback);
				fse.readFile(filePath, 'utf8', fileHandler);
			};
		},
		loadTemplates = function (lt_callback) {
			var functions = [], i, l, template;

			console.log('loading ' + dataObj.site.templates.length + ' templates...');
			if (dataObj.site.templates.length > 0) {
				for (i = 0, l = dataObj.site.templates.length; i < l; i++) {
					console.log('loading template ' + (i + 1) + ' of ' + l + '...');
					template = dataObj.site.templates[i];
					templates[template.id] = template;
					// open file templateFile and load into string
					if (template.templateFile) {
						functions.push(getTemplateHandler(template));
					}
				}
			}

			async.parallel(functions, getAsyncCallback('loadTemplates', lt_callback));
		},

		// page processing
		saveFileHandler = function (destination, sfh_callback) {
			return function (err) {
				handleError(err, 'saveFileHandler');

				console.log(destination + ' written.');

				sfh_callback(null);
			};
		},
		matchExtension = /\.([^\.]+)$/i,
		getFileHandler = function	(dest, fileText, doCompression) {
			return function (gfh_callback) { 
				if (doCompression) {
					// compress...
					switch (dest.match(matchExtension)[1].toLowerCase()) {
						case 'json': 
							fileText = jsonminify(fileText);
							break;
						case 'html': 
							fileText = htmlminifier.minify(fileText, {
								removeComments: true,
								collapseWhitespace: true,
								useShortDoctype: true,
								keepClosingSlash: true,
								minifyJS: true,
								minifyCSS: true
							});
							break;
						case 'xml': 
							// this output was no longer XML:
							//fileText = htmlminifier.minify(fileText, {
							//	removeComments: true,
							//	collapseWhitespace: true
							//});
							break;
					}
				}
				fse.outputFile(dest, fileText, saveFileHandler(dest, gfh_callback));
			};
		},
		getTemplateProcessFunction = function (msg, templateId, data) {
			console.log(msg);

			var template = templates[templateId],
				fileText = template.renderText(data),
				destination = template.renderDestination(data);

			return getFileHandler(destination, fileText, cfg.compress);
		},

		getFilteredList = function (list, max, prop, val) {
			var rows = [], index, length,
					mid = Math.floor(max / 2),
					found = false;
  
			for (index = 0, length = list.length; index < length && (mid > 0 || rows.length < max); index++) {
				rows.push(list[index]);
				if (rows.length > max) {
					rows.shift();
				}
				if (found) {
					mid--;
				}

				// handle 'next' item, if item was found previously:
				if (found && rows.length > 1 && 
					// check if previous item had prop
					rows[rows.length - 2].pageRel && 
					// check if previous item was 'self'
					rows[rows.length - 2].pageRel === 'self') {
					rows[rows.length - 1].pageRel = 'next';
				}

				// assumes prop is primary key
				if (list[index][prop] === val) {
					// adding special property
					rows[rows.length - 1].pageRel = 'self';
					if (rows.length > 1) {
						rows[rows.length - 2].pageRel = 'prev';
					}
					found = true;
				}
			}

			if (!found) {
				// if the page was never found in the items, return the latest `max` rows
				rows = list.slice(0, max);
			}

			return rows;
		},
		processPage = function (page, siteParent, allCategorizedPages, functions) {
			var msg, i, l;
			// add reference to site object
			page.parent = siteParent;
			page.bodyNavItems = getFilteredList(dataObj.site.orderedPosts, cfg.navItemCount, 
				'relativePath', page.relativePath);

			if (!page.isHidden && page.categories && page.categories.length > 0) {
				for (i = 0, l = page.categories.length; i < l; i++) {
					// make sure category array exists and add page to it:
					allCategorizedPages[page.categories[i]] = allCategorizedPages[page.categories[i]] || [];
					allCategorizedPages[page.categories[i]].push(page);
				}
			}

			// each page will likely have at least an HTML and JSON version
			for (i = 0, l = page.templates.length; i < l; i++) {
				msg = 'processing page template ' + (i + 1) + ' of ' + l + '...';
				functions.push(getTemplateProcessFunction(msg, page.templates[i], page));
			}

			// check for redirects
			if (page.redirects && page.redirects.length > 0) {
				for (i = 0, l = page.redirects.length; i < l; i++) {
					page.currentRedirect = page.redirects[i];
					msg = 'generating redirect ' + (i + 1) + ' of ' + l + '...';
					functions.push(getTemplateProcessFunction(msg, 'redirect', page));
				}
			}
		},

		processPages = function (pp_callback) {		
			console.log('processing ' + dataObj.site.pages.length + ' pages...');
			var functions = [], 
				allCategorizedPages = {},
				i, l, msg,
				startYear, endYear, currentYear,
				siteParent = dataObj.site,
				orderedPages = dataObj.site.pages.sort(function (a, b) {
					var aDate = new Date(a.pubDate),
							bDate = new Date(b.pubDate);
					// order by date desc
					if (aDate > bDate) {
						return -1;
					} 
					if (aDate < bDate) {
						return 1;
					}
					return 0;
				}),
				postMatch = /^\/posts\//,
				orderedPosts = orderedPages.filter(function (el) {
						return postMatch.test(el.relativePath);
				});

			if (dataObj.site.pages.length > 0) {
				dataObj.site.orderedPosts = orderedPosts;
				for (i = 0, l = dataObj.site.pages.length; i < l; i++) {
					console.log('loading page ' + (i + 1) + ' of ' + l + '...');
					processPage(dataObj.site.pages[i], siteParent, allCategorizedPages, functions);
				}

				// clone site object into 'parent' so that partial handlebars templates can be re-used
				dataObj.site.parent = dataObj.site;
				dataObj.site.bodyNavItems = getFilteredList(dataObj.site.orderedPosts, cfg.navItemCount, 
				'relativePath', '');

				// archives: go through posts folders for yyyy-mm-dd?
				startYear = new Date(orderedPosts[0].pubDate).getFullYear();
				endYear = new Date(orderedPosts[orderedPosts.length - 1].pubDate).getFullYear();
				currentYear = startYear;

				console.log('generating archives from ' + startYear + ' to ' + endYear + '...');
				dataObj.site.recentPosts = orderedPosts.slice(0, cfg.navItemCount);
				do {
					dataObj.site.archiveFilter = '/posts/' + currentYear;
					msg = 'generating ' + currentYear + ' archive...';
					functions.push(getTemplateProcessFunction(msg, 'archive', dataObj.site));
				} while (currentYear-- > endYear);

				// or one monolithic archive?
				dataObj.site.archiveFilter = '/posts';
				msg = 'generating mega archive...';
				functions.push(getTemplateProcessFunction(msg, 'archive', dataObj.site));

				// categories: go through all categories for all pages and create single categories archive page?
				dataObj.site.categorizedPages = allCategorizedPages;
				msg = 'generating categories archive...';
				functions.push(getTemplateProcessFunction(msg, 'categories', dataObj.site));

				// rss/atom: order pages by date descending, only posts, limited number
				dataObj.site.pages = orderedPosts.slice(0, cfg.syndicationMax);

				msg = 'generating rss xml...';
				functions.push(getTemplateProcessFunction(msg, 'rss', dataObj.site));

				msg = 'generating atom xml...';
				functions.push(getTemplateProcessFunction(msg, 'atom', dataObj.site));

				// home page using new home.handlebars
				msg = 'generating home page...';
				functions.push(getTemplateProcessFunction(msg, 'home', dataObj.site));

				msg = 'generating manifest.webapp...';
				functions.push(getTemplateProcessFunction(msg, 'manifest', dataObj.site));

				// do sitemap last:
				msg = 'generating sitemap...';
				functions.push(getTemplateProcessFunction(msg, 'sitemap', dataObj.site));

			}

			async.parallel(functions, getAsyncCallback('processPages', pp_callback));
		},

		// load json data and process
		getLoadJsonData = function (gljd_callback) {
			return function (err, data) {
				handleError(err, 'loadJsonData');

				console.log('parsing json...');
				dataObj = JSON.parse(data);
				console.log('site: ' + dataObj.site.title);

				// load config & environment variables
				dataObj.site.config = cfg;
				dataObj.site.environment = env;

				console.log('loading handlebars utility functions...');
				handlebars.registerHelper('moment', momentHelper);
				handlebars.registerHelper('startsWith', startsWithHelper);
				handlebars.registerHelper('equals', equalsHelper);
				handlebars.registerHelper('coalesce', coalesceHelper);
				handlebars.registerHelper('static', staticAssetHelper);
				handlebars.registerHelper('gravatar', gravatarHelper);

				async.series([loadTemplates, processPages], 
					getAsyncCallback('loadJsonData', gljd_callback));
			};
		};

	console.log(env.now);
	console.log(env.name + ', ' + env.version);

	// possible future enhancement: 
	// before copying, if files exist in destination, archive to zip and clean destination folder

	async.series([function (as1_callback) {
			fse.exists(cfg.destPath(), function (exists) {
				if (exists) {
					var ez = new EasyZip(),
						zipFileName = 'backup-' + moment(env.now).format('YYYYMMDD-HHmm') + '.zip';

					console.log('zipping up existing files into ' + zipFileName + '...');
					ez.zipFolder(cfg.destPath(), function () {
						ez.writeToFile(cfg.path('/' + zipFileName));
						as1_callback(null);
					});
				} else {
					as1_callback(null);
				}
			});
		},
		function (as2_callback) {
			fse.exists(cfg.destPath(), function (exists) {
				if (exists) {
					console.log('removing existing files...');
					fse.remove(cfg.destPath(), as2_callback);
				} else {
					as2_callback(null);
				}
			});
		},
		function (as3_callback) {
			copyAssets(as3_callback);
		},
		function (as4_callback) {
			fileVersioner(as4_callback);
		},
		function (as5_callback) {
			console.log('reading json data file...');
			
			var dataFile = cfg.path(cfg.dataFile),
				args = process.argv.slice(2);
				
			// override 'data.json' filename from command-line args
			if (args.length > 0) {
				dataFile = args[1];
				console.log('using command-line argument override: ' + dataFile);
			}
			
			fse.readFile(dataFile, 'utf8', getLoadJsonData(as5_callback));
		},
		function (as6_callback) {		
			// gz sitemap
			var gzip = zlib.createGzip(),
				instream = fse.createReadStream(cfg.destPath('/sitemap.xml')),
				outstream = fse.createWriteStream(cfg.destPath('/sitemap.xml.gz'));

			console.log('gzipping sitemap...');
			instream.pipe(gzip).pipe(outstream);

			as6_callback(null);
		}],
			getAsyncCallback('first async.series', function () {
				env.dateEnd = new Date();
				console.log(env.dateEnd);
				console.log('elapsed time: ' + moment(env.dateEnd).diff(env.now, 'seconds', true) + ' seconds.');
				console.log('suo finished.');
			})
    );

	return global;
}(this));