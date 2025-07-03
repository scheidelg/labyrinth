/* =============================================================================
 * labyrinth.js
 * -----------------------------------------------------------------------------
 * Server-side JavaScript leveraging nginx JavaScript (njs) to generate random
 * labyrinth pages by pulling multiple random blocks of text from a corpus file,
 * formatting each block with an anchor tag to create an HREF that leads to an
 * additional labyrinth page, and concatenating the formatted blocks together.
 * Arguments to the script control the size of each block, the total amount of
 * content to retrieve, the server-side location of the corpus file, and the
 * URI path to use in crafting labyrinth links.
 *
 * (c) Greg Scheidel - CC-BY-NC-ND -- see https://github/scheidel/labyrinth
 * -----------------------------------------------------------------------------
 * Arguments - Passed using 'set' statements in the nginx web service
 * configuration.
 *
 * Note: All argument values in the r.variables object are strings, so typeof
 * isn't useful to determine variable type.
 *
 * r.variables.base_path    string; required; no default
 *
 *     Base path to use when creating hyperlinks to additional labyrinth pages.
 *     A random page is appended to this base. For example, a base path of
 *     '/ephi/' might result in a hyperlink to 'ephi/werAEIOxk.html'.
 *
 *     Example conf line: `set $base_path '/ephi/';`
 *
 * r.variables.block_size   integer (# of bytes); optional; default of 80
 *
 *     The script reads from the corpus file multiple times, which each request
 *     starting form a random offset within the file.  This variable identifies
 *     how big of a block, in bytes, to read each time.
 *
 *     Example conf line: `set $block_size 80;`
 *
 * r.variables.corpus       string; required; no default
 *
 *     Path to the corpus file that is accessed to retrieve random bits of text,
 *     which are then hyperlinked to additional labyrinth pages, concatenated
 *     together, formatted as a web page, and returned to the client.
 *
 *     Example conf line: `set $corpus '/etc/nginx/data/bladerunner.txt';`
 *
 * r.variables.total_size   integer (# of bytes); optional; default of 500
 *
 *     The total size, in bytes, of the text that is to be retrieved and then
 *     concatenaged together, across all of the reads.
 *
 *     Example conf line: `set $total_size 500;`
 * -----------------------------------------------------------------------------
 */

// load the file system module, for statSync, openSync, readSync, closeSync
const fs = require('fs');

function random_content(r) {
    /* -------------------------------------------------------------------------
     * Variables
     *
     * base_path            string
     *
     *     r.variables.base_path value, saved here for local manipulation.
     *
     * block_size           integer (# of bytes)
     *
     *     r.variables.block_size value, saved here for local manipulation.
     *
     * built_contents       string
     *
     *     Concatenated string of all of the retrieved content, after each piece
     *     has been formatted as an HREF using an anchor tag.  At the end of the
     *     script, combined with HTML content to create a fully formed HTML page.
     *
     * bytes_read           string
     *
     *     Return value from fs.readSync calls.
     *
     * concatenated_text_length integer
     *
     *     Running total of the amount of text that was retrieved from the
     *     corpus, for comparison against block_size (to know when to stop).
     *
     * corpus_stats         fs.Stats object
     * 
     *     Information about the corpus file, retrieved with fs.statSync. Mainly
     *     (currently only) used to check corpus.stats.size -- the number of
     *     bytes in the corpus file.
     *
     * fd                   file descriptor
     *
     *     To open and work with the corpus file.
     *
     * function_name        const string
     *
     *     Name of the function; used soley in console.log() and console.error()
     *     messages.
     *
     * line_read            string
     *
     *     Data retrieved from fs.readSync calls -- after conversion to a UTF8
     *     string.
     *
     * loop_limiter         integer
     *
     *     Countdown integer, used to avoid a huge number of reads if the corpus
     *     content is mostly whitespace.  Initial value calculated as
     *     ( Math.ceil(total_size / block_size) * 2 ).
     *
     * read_buffer          string
     *
     *     Data retrieved from fs.readSync calls.
     *
     *     Note: No need to de-allocate the buffer, JavaScript garbage cleanup
     *     takes care of it on exit from the script.
     *
     * read_offset          string
     *
     *     Used with fs.readSync calls to start reading at a random location
     *     within the corpus file.
     *
     * total_size           integer (# of bytes)
     *
     *     r.variables.total_size value, saved here for local manipulation.
     *
     * -------------------------------------------------------------------------
     */

    const function_name = 'random_content()';

    let base_path;
    let block_size;
    let built_contents;
    let bytes_read;
    let concatenated_text_length;
    let corpus_stats;
    let fd;
    let line_read;
    let loop_limiter;
    let read_buffer;
    let read_offset;
    let total_size;

    try {
        /* Perform basic argument validation
         *
         * Note: All argument values in the r.variables object are strings, so
         * typeof isn't useful to determine variable type. */

        // 'base_path' needs to be present; if it isn't, then error out.
        if (r.variables.hasOwnProperty('base_path')) {
            if (r.variables.base_path == '') {
                throw new RangeError(function_name + ' error: base_path argument is empty');
            }
        } else {
            throw new SyntaxError(function_name + ' error: base_path argument missing');
        }

        // if the base_path doesn't end with a '/' character, then add it
        if (r.variables.base_path.slice(-1) == '/') {
            base_path = r.variables.base_path;
	} else {
            base_path = r.variables.base_path + '/';
        }

        // 'corpus' needs to be present; if it isn't, then error out.  File
        // operations will test whether the value is a valid filename.
        if (r.variables.hasOwnProperty('corpus')) {
            if (r.variables.corpus == '') {
                throw new RangeError(function_name + ' error: corpus argument is empty');
            }
        } else {
            throw new SyntaxError(function_name + ' error: corpus argument missing');
        }

        // if passed, 'block_size' must be a positive integer
        if (r.variables.hasOwnProperty('block_size')) {
            block_size = parseInt(r.variables.block_size, 10);

            if (block_size <= 0) {
                throw new RangeError(function_name + ' error: block_size argument is not a positive integer');
            }
        // if not passed, set default value
        } else {
            block_size = 80;
        }

        // if passed, 'total_size' must be a positive integer
        if (r.variables.hasOwnProperty('total_size')) {
            total_size = parseInt(r.variables.total_size, 10);

            if (total_size <= 0) {
                throw new RangeError(function_name + ' error: total_size argument is not a positive integer');
            }
        // if not passed, set default value
        } else {
            total_size = 500;
        }

        // get the size of the corpus file, so that we can read from random
        // locations in the file (without going over the file size)
        corpus_stats = fs.statSync(r.variables.corpus);

        // if the file size is 0, then error out
        if (corpus_stats.size == 0) {
            throw new Error(function_name + ' error: corpus file size is empty');
        }

        // adjust block_size and total_size based on the file size; they can't
        // be bigger than the corpus file size in bytes
        block_size = Math.min(corpus_stats.size, block_size);
        console.log(function_name + ': Validated block_size argument value, set to ' + block_size);

        total_size = Math.min(corpus_stats.size, total_size);
        console.log(function_name + ': Validated total_size argument value, set to ' + total_size);

        // open the corpus file
        fd = fs.openSync(r.variables.corpus, 'r');
        console.log(function_name + ': Opened fd.');

        // allocate a buffer to store each block of data read from the file
        read_buffer = Buffer.alloc(block_size);

        // initialize the built_contents variable to an empty string, and
        // concatenated_text_length to 0
        built_contents = '';
        concatenated_text_length = 0;

        /* In each iteration, CR/LF, LF, and dupblicate spaces are stripped
         * out, so a single read can end up with less than one block's worth of
         * characters.  Set a limit on the number of read's we'll perform to
         * reach the requested content size, based on the assumption that if
         * the content is more than 50% fluff then we should just call it. */
        loop_limiter = Math.ceil(total_size / block_size) * 2;

        // loop until reaching the requested content size, or the loop limiter
        // decrements to 0
        while (concatenated_text_length < total_size && loop_limiter > 0) {

            // Generate a random number between 0 and ((corpus size) - 1).  This
            // will be the offset within the file to start reading at.
            read_offset = Math.floor(Math.random() * corpus_stats.size);

            /* Read from the file starting at the random offset, up to the
             * buffer size.
             *
             * Note that readSync() will only read up to the end of the file, so
             * it's not a problem if the random offset is closer to the end of the
             * file than the number of bytes to read. */
            bytes_read = fs.readSync(fd, read_buffer, 0, block_size, read_offset);

            /* If the number of bytes read is less than the block size, then read
             * some more from the start of the file to get the total desired block
             * size (i.e., wrap around to the start of the file to read th desired
             * # of bytes). */
            if (bytes_read < block_size) {
                bytes_read = fs.readSync(fd, read_buffer, bytes_read, (block_size - bytes_read), 0);
            }

            // convert the buffer contents to a UTF8 string
            line_read = read_buffer.toString('utf8');

            /* Strip out all CR/LF, LF, and double spaces from the retrieved
             * content (it doesn't matter in terms of how the content renders,
             * but we don't want to those characters when seeing if the amount
             * of retrieved content has reached the total requested size). */
            line_read = line_read.replace(/(\r*\n)+/g, ' ');
            line_read = line_read.replace(/ +/g, ' ');

            /* If the length of this line will cause the retrieved and
             * concatenated text to exceed the total amount of text we want to
	     * display, then trim the line. */
            if (concatenated_text_length + line_read.length > total_size) {
                line_read = line_read.slice(0, total_size - (concatenated_text_length + line_read.length));
                concatenated_text_length = total_size;

	    } else {
                /* Add the length of this content to our running total, so that
                 * we know how much text was retrieved after stripping out
                 * whitespace but before adding the anchor tags. */
                concatenated_text_length += line_read.length;
            }

            /* Add this to the content read so far, using an anchor tag to
             * formatting this line as an HREF that points to a random page
	     * name.
             * - get a random float
             * - convert to a base-36 value
             * - drop the leading '.0' characters
             * - add '.html' */
            built_contents += '<a href="' + base_path + Math.random().toString(36).substring(2) + '.html' + '">' + line_read + '</a>';

            // decrement the loop limiter
            loop_limiter -= 1
        }


        // Build the content to return, incorporating the random content that
        // we've gathered.
        built_contents = `<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Replicant EPHI</title>
        <link rel="stylesheet" href="/css/style.css">
    </head>
    <body>
        <div id="container"><p>` + built_contents + `</p></div>
    </body>
</html>`;

        r.return(200, built_contents);
        //r.return(200, read_buffer);

    } catch (error) {
        console.error(function_name + ' error:', error);

        // To facilitate troubleshooting, comment the generic error message and
        // uncomment the 'e.toString()' line.  Also check the nginx console and
        // error logs.
        r.return(500, 'Replicant data could not be loaded. Please contact a system administrator.');
        //r.return(500, error.toString());

    } finally {
        // If fd is *not* undefined, then attempt to close the file descriptor
        // (just to make sure things are cleaned up properly).
        if (typeof fd !== 'undefined') {
            try {
                fs.closeSync(fd);
                console.log(function_name + ': Closed fd.');
            } catch (inner_error) {
                console.error(function_name + ' error: Unable to close fd:', inner_error);
            }
        }
    }
}

export default {random_content};
