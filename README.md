# Web Labyrinth

This project sets up an nginx server inside a Docker container to host a 'web labyrinth' that traps crawlers in an endless maze. Each page served up by the labyrinth consists of content pulled randomly from a corpus file, with the content formatted with hyperlinks that retrieve additional labyrinth pages. Well-behaved crawlers see a `robots.txt` disallowing access to `/ephi.html`; malicious actors that ignore the `robots.txt` instructions are lured into the labyrinth.

Additional details on the operation of the application are in the comments of the configuration, HTML, and script files.

## Project Structure

- `Dockerfile` : Instructions to create the Docker image for the labyrinth container.
- `README.md` : This file.
- `data/`
    - `Bladerunner.txt` : Corpus text file (the script for the Bladerunner movie).
- `docker-compose.yml` : Docker compose file defining the application container.
- `html/` : Root of the web content served up by the labyrinth.
    - `css/`
        - `style.css` : Style sheet.
    - `index.html` : Main page of the web site; the 'legitimate' page for users and crawlers.
    - `robots.txt` : The file that tells well-behaved crawlers what to skip over -- and tells attackers what to home in on.
- `js/`
    - `labyrinth.js` : Server-side JaveScript that generates the random pages (with links to additional labyrinth pages), using nginx JavaScript (njs).
- `nginx-conf`
    - `default.conf` : Configuration for the web site, including the redirect to the labyrinth content.
    - `nginx.conf` : Configuration for the nginx service, including loading the `ngx_http_js_module.so` module and importing the labyrinth.js script file.

## Startup

From within the directory containing the `docker-compose.yml` file, start the application container using Docker Compose.

```bash
docker compose up -d
```

Or, if you are using the original version of Docker Compose as a standalone Python-based tool:

```bash
docker-compose up -d
```

This starts the container in detached mode, and the nginx web service is mapped to host port 8080/tcp.

*Note: The port mapping can be modified by editing the `docker-compose.yml` file.*

## Accessing the Main Page

On the host running the Docker container, browse to the web site on `http://localhost:8080`.

*Note: The site can also be accessed by other computers that have network access to the host running the Docker container.*

## Accessing the `robots.txt` Page

Browse to `http://localhost:8080/robots.txt`.

```
User-agent: *
Disallow: /ephi.html
```

All clients are disallowed access to `/ephi.html`.

## Viewing Labyrinth Activity Logs

You can view and follow the labyrinth activity logs with the following command:

```
docker logs -f labyrinth_web_1 2>&1 | grep '/ephi'
```

*Note:*
- *If you change the base path for the labyrinth content in the `docker-compose.yml` file, change this filter to match.*
- *If your cloned repository isn't in a directory named `labyrinth/`, then the name of the docker container will be different.*

## Simulating Well-behaved Crawlers

Well-behaved crawlers will respect the `robots.txt` directives. This can be simulated with a command similar to the following:

```
wget --spider --recursive http://localhost:8080/
```

## Simulating Ill-behaved Crawlers

Ill-behaved crawlers will ignore the `robots.txt` directives. This can be simulated with a command similar to the following:

```
wget -e robots=off --spider --recursive http://localhost:8080/
```

## Shutdown

From within the directory containing the `docker-compose.yml` file, use Docker Compose to stop and remove the application container and network:

```bash
docker compose down
```

Or, if you are using the original version of Docker Compose as a standalone Python-based tool:

```bash
docker-compose down
```

## Author

This project was created by Greg Scheidel (@greg_scheidel).

## Credit

The project concept was inspired by (and uses the `style.css` file from) https://github.com/aboutsecurity/tyrellgrid, written by Ismael Valenzuela (@aboutsecurity), author of SANS Security 530, the #AllAroundDefender class; but uses server-side JavaScript so that automated web crawlers will get trapped in the labyrinth.

Both this project and Ismael's project were inspired by https://github.com/mayhemiclabs/weblabyrinth.
