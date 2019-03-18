const config = require("./config");
const utils = require("./utils");
const cutils = require("./commandutils");

// Stores user commands (accessible via trigger word set in config.js)
// Command order indicates (and determines) precedence
const funcs = {
    "help": (threadId, cmatch) => { // Check help first to avoid command conflicts
        let input;
        if (cmatch[1]) {
            input = cmatch[1].trim().toLowerCase();
        }
        if (input && input.length > 0) {
            // Give details of specific command
            const entry = getHelpEntry(input, cmatch);
            if (entry) {
                const info = entry.entry;

                const example = {}; // Fill example data (sometimes array; sometimes string)
                if (Array.isArray(info.example)) {
                    example.header = "Examples:\n";
                    example.body = info.example.map((e) => {
                        return `${config.trigger} ${e}`; // Add trigger to example
                    }).join("\n");
                } else if (info.example.length > 0) {
                    example.header = "Example: ";
                    example.body = `${config.trigger} ${info.example}`;
                }

                const helpMsg = `Entry for command "${info.pretty_name}":\n${info.description}\n\nSyntax: ${config.trigger} ${info.syntax}${example.header ? `\n\n${example.header}${example.body}` : ""}`;
                const addenda = `${info.attachments ? "\n\n(This command accepts attachments)" : ""}${info.sudo ? "\n\n(This command requires admin privileges)" : ""}${info.experimental ? "\n\n(This command is experimental)" : ""}`;
                getStats(entry.key, false, (err, stats) => {
                    if (err) { // Couldn't retrieve stats; just show help message
                        utils.sendMessage(`${helpMsg}${addenda}`, threadId);
                    } else {
                        const perc = (((stats.count * 1.0) / stats.total) * 100) || 0;
                        utils.sendMessage(`${helpMsg}\n\nThis command has been used ${stats.count} ${stats.count == 1 ? "time" : "times"}, representing ${perc.toFixed(3)}% of all invocations.${addenda}`, threadId);
                    }
                });
            } else {
                sendError(`Help entry not found for "${input}"`, threadId);
            }
        } else {
            // No command passed; give overview of all of them
            let mess = `Quick help for ${config.bot.names.short || config.bot.names.long}:\n\nPrecede these commands with "${config.trigger}":\n`;
            for (let c in cmatch) {
                if (co.hasOwnProperty(c)) {
                    const entry = co[c];
                    if (entry.display_names.length > 0) { // Don't display if no display names (secret command)
                        // Only display short description if one exists
                        mess += `${entry.syntax}${entry.short_description ? `: ${entry.short_description}` : ""}${entry.sudo ? " [ADMIN]" : ""}\n`;
                        mess += "------------------\n"; // Suffix for separating commands
                    }
                }
            }
            mess += `Contact ${config.owner.names.long} with any questions, or use "${config.trigger} bug" to report bugs directly.\n\nTip: for more detailed descriptions, use "${config.trigger} help {command}"`;
            utils.sendMessage(mess, threadId);
        }
    },
    "stats": (threadId, cmatch, groupInfo) => {
        const command = cmatch[1];
        getStats(command, true, (err, stats) => {
            let input;
            if (cmatch[1]) {
                input = cmatch[1].trim().toLowerCase();
            }
            if (input && input.length > 0) {
                // Give details of specific command
                const entry = getHelpEntry(input, cmatch);
                if (entry) {
                    const key = entry.key;
                    const info = entry.entry;
                    getStats(key, true, (err, stats) => {
                        if (!err) {
                            stats = getComputedStats(stats);
                            let m = `'${info.pretty_name}' has been used ${stats.count} ${stats.count == 1 ? "time" : "times"} out of a total of ${stats.total} ${stats.total == 1 ? "call" : "calls"}, representing ${stats.usage.perc.toFixed(3)}% of all bot invocations.`;
                            m += `\n\nIt was used ${stats.usage.day} ${stats.usage.day == 1 ? "time" : "times"} within the last day and ${stats.usage.month} ${stats.usage.month == 1 ? "time" : "times"} within the last month.`;

                            const user = getHighestUser(stats.record);
                            if (user) { // Found a user with highest usage
                                const name = groupInfo.names[user] || "not in this chat";
                                m += `\n\nIts most prolific user is ${name}.`;
                            }

                            utils.sendMessage(m, threadId);
                        }
                    });
                } else {
                    sendError(`Entry not found for ${input}`, threadId);
                }
            } else {
                // No command passed; show all
                getAllStats((success, data) => {
                    if (!success) {
                        console.log("Failed to retrieve all stats");
                    }
                    for (let i = 0; i < data.length; i++) {
                        data[i].stats = getComputedStats(data[i].stats); // Get usage stats for sorting
                    }
                    data = data.sort((a, b) => {
                        return (b.stats.usage.perc - a.stats.usage.perc); // Sort greatest to least
                    });

                    let msg = "Command: % of total usage | # today | # this month\n";

                    data.forEach((cmatch) => {
                        msg += `\n${co.pretty_name}: ${co.stats.usage.perc.toFixed(3)}% | ${co.stats.usage.day} | ${co.stats.usage.month}`;
                    });

                    utils.sendMessage(msg, threadId);
                });
            }
        });
    },
    "psa": (cmatch) => {
        sendToAll(`"${cmatch[1]}"\n\nThis has been a public service announcement from ${config.owner.names.short}.`);
    },
    "bug": (cmatch, groupInfo, _, fromUserId) => {
        utils.sendMessage(`-------BUG-------\nMessage: ${cmatch[1]}\nSender: ${groupInfo.names[fromUserId]}\nTime: ${getTimeString()} (${getDateString()})\nGroup: ${groupInfo.name}\nID: ${groupInfo.threadId}\nInfo: ${JSON.stringify(groupInfo)}`, config.owner.id, (err) => {
            if (!err) {
                if (groupInfo.isGroup && !cutils.contains(config.owner.id, groupInfo.members)) { // If is a group and owner is not in it, add
                    utils.sendMessage(`Report sent. Adding ${config.owner.names.short} to the chat for debugging purposes...`, groupInfo.threadId, () => {
                        addUser(config.owner.id, groupInfo, false);
                    });
                } else { // Otherwise, just send confirmation
                    utils.sendMessage(`Report sent to ${config.owner.names.short}.`, groupInfo.threadId);
                }
            } else {
                utils.sendMessage(`Report could not be sent; please message ${config.owner.names.short} directly.`, groupInfo.threadId);
            }
        });
    },
    "kick": (cmatch, groupInfo) => {
        const user = cmatch[1].toLowerCase();
        const optTime = cmatch[2] ? parseInt(cmatch[2]) : undefined;
        try {
            // Make sure already in group
            if (groupInfo.members[user]) {
                // Kick with optional time specified in call only if specified in command
                kick(groupInfo.members[user], groupInfo, optTime);
            } else {
                throw new Error(`User ${user} not recognized`);
            }
        } catch (e) {
            sendError(e);
        }
    },
    "xkcd": (threadId, cmatch) => { // Check before regular searches to prevent collisions
        if (cmatch[1]) { // Parameter specified
            const query = cmatch[2];
            const param = cmatch[1].split(query).join("").trim(); // Param = 1st match - 2nd
            if (query && param == "search") {
                // Perform search using Google Custom Search API (provide API key / custom engine in config.js)
                const url = `https://www.googleapis.com/customsearch/v1?key=${config.xkcd.key}&cx=${config.xkcd.engine}&q=${encodeURIComponent(query)}`;
                request(url, (err, res, body) => {
                    if (!err && res.statusCode == 200) {
                        const results = JSON.parse(body).items;
                        if (results.length > 0) {
                            utils.sendMessage({
                                "url": results[0].formattedUrl // Best match
                            }, threadId);
                        } else {
                            sendError("No results found", threadId);
                        }
                    } else {
                        console.log(err);
                    }
                });
            } else if (param == "new") { // Get most recent (but send as permalink for future reference)
                request("http://xkcd.com/info.0.json", (err, res, body) => {
                    if (!err && res.statusCode == 200) {
                        const num = parseInt(JSON.parse(body).num); // Number of most recent xkcd
                        utils.sendMessage({
                            "url": `http://xkcd.com/${num}`
                        }, threadId);
                    } else {
                        // Just send to homepage for newest as backup
                        utils.sendMessage({
                            "url": "http://xkcd.com/"
                        }, threadId);
                    }
                });
            } else if (param) { // If param != search or new, it should be either a number or valid sub-URL for xkcd.com
                utils.sendMessage({
                    "url": `http://xkcd.com/${param}`
                }, threadId);
            }
        } else { // No parameter passed; send random xkcd
            // Get info of most current xkcd to find out the number of existing xkcd (i.e. the rand ceiling)
            request("http://xkcd.com/info.0.json", (err, res, body) => {
                if (!err && res.statusCode == 200) {
                    const num = parseInt(JSON.parse(body).num); // Number of most recent xkcd
                    const randxkcd = Math.floor(Math.random() * num) + 1;
                    utils.sendMessage({
                        "url": `http://xkcd.com/${randxkcd}`
                    }, threadId);
                }
            });
        }
    },
    "wiki": (threadId, cmatch) => {
        const query = cmatch[1];
        // Perform search using Google Custom Search API (provide API key / custom engine in config.js)
        const url = `https://www.googleapis.com/customsearch/v1?key=${config.wiki.key}&cx=${config.wiki.engine}&q=${encodeURIComponent(query)}`;
        request(url, (err, res, body) => {
            if (!err && res.statusCode == 200) {
                const results = JSON.parse(body).items;
                if (results.length > 0) {
                    utils.sendMessage({
                        "url": results[0].formattedUrl // Best match
                    }, threadId);
                } else {
                    sendError("No results found", threadId);
                }
            } else {
                console.log(err);
            }
        });
    },
    "spotsearch": (threadId, cmatch) => {
        logInSpotify((err) => {
            if (!err) {
                const query = cmatch[2];
                if (cmatch[1].toLowerCase() == "artist") {
                    // Artist search
                    spotify.searchArtists(query, {}, (err, data) => {
                        if (!err && data.body) {
                            const bestMatch = data.body.artists.items[0];
                            const id = bestMatch.id;
                            if (id) {
                                spotify.getArtistTopTracks(id, "US", (err, data) => {
                                    if (!err) {
                                        const tracks = data.body.tracks;
                                        const link = bestMatch.external_urls.spotify;
                                        const image = bestMatch.images[0];
                                        const popularity = bestMatch.popularity;
                                        let message = `Best match: ${bestMatch.name}\nPopularity: ${popularity}%\n\nTop tracks:\n`;
                                        for (let i = 0; i < config.spotifySearchLimit; i++) {
                                            if (tracks[i]) {
                                                message += `${tracks[i].name}${tracks[i].explicit ? " (Explicit)" : ""} (from ${tracks[i].album.name})${(i != config.spotifySearchLimit - 1) ? "\n" : ""}`;
                                            }
                                        }

                                        if (image) {
                                            // Send image of artist
                                            sendFileFromUrl(image, "media/artist.png", message, threadId);
                                        } else if (link) {
                                            // Just send link
                                            utils.sendMessage({
                                                "body": message,
                                                "url": bestMatch
                                            }, threadId);
                                        } else {
                                            // Just send message
                                            utils.sendMessage(message, threadId);
                                        }
                                    }
                                });
                            } else {
                                sendError(`No results found for query "${query}"`, threadId);
                            }
                        } else {
                            sendError(err, threadId);
                        }
                    });
                } else {
                    // Song search
                    spotify.searchTracks(query, {}, (err, data) => {
                        if (!err) {
                            const bestMatch = data.body.tracks.items[0];
                            if (bestMatch) {
                                const message = `Best match: ${bestMatch.name} by ${getArtists(bestMatch)} (from ${bestMatch.album.name})${bestMatch.explicit ? " (Explicit)" : ""}`;
                                const url = bestMatch.external_urls.spotify;
                                const preview = bestMatch.preview_url;

                                if (preview) {
                                    // Upload preview
                                    sendFileFromUrl(preview, "media/preview.mp3", message, threadId);
                                } else {
                                    // Just send Spotify URL
                                    utils.sendMessage({
                                        "body": message,
                                        "url": url
                                    }, threadId);
                                }
                            } else {
                                sendError(`No results found for query "${query}"`, threadId);
                            }
                        } else {
                            sendError(err, threadId);
                        }
                    });
                }
            } else {
                console.log(err);
            }
        });
    },
    "song": (threadId, cmatch, groupInfo) => {
        logInSpotify((err) => {
            if (!err) {
                const user = cmatch[1] ? cmatch[1].toLowerCase() : null;
                const userId = groupInfo.members[user];
                const playlists = groupInfo.playlists;
                const ids = Object.keys(playlists);

                let playlist; // Determine which to use
                if (playlists && ids.length > 0) { // At least 1 playlist stored
                    // Find random playlist in case one isn't specified or can't be found
                    const randPlaylist = playlists[ids[Math.floor(Math.random() * ids.length)]];
                    if (user && userId) {
                        // User specified
                        if (playlists[userId]) {
                            // User has a playlist
                            playlist = playlists[userId];
                        } else {
                            // User doesn't have playlist; use random one
                            playlist = randPlaylist;
                            utils.sendMessage(`User ${groupInfo.names[userId]} does not have a stored playlist; using ${playlist.name}'s instead.`, threadId);
                        }
                    } else {
                        // No playlist specified; grab random one from group
                        playlist = randPlaylist;
                    }
                } else {
                    playlist = config.defaultPlaylist;
                    utils.sendMessage(`No playlists found for this group. To add one, use "${config.trigger} playlist" (see help for more info).\nFor now, using the default playlist.`, threadId);
                }

                spotify.getPlaylist(playlist.user, playlist.uri, {}, (err, data) => {
                    if (!err) {
                        const name = data.body.name;
                        const songs = data.body.tracks.items;
                        let track = songs[Math.floor(Math.random() * songs.length)].track;
                        let buffer = 0;
                        while (!track.preview_url && buffer < songs.length) { // Don't use songs without previews if possible
                            track = songs[Math.floor(Math.random() * songs.length)].track;
                            buffer++;
                        }
                        utils.sendMessage(`Grabbing a song from ${playlist.name}'s playlist, "${name}"...`, threadId);
                        const msg = `How about ${track.name} (from "${track.album.name}") by ${getArtists(track)}${track.explicit ? " (Explicit)" : ""}?`;
                        if (track.preview_url) {
                            // Send preview MP3 to chat if exists
                            sendFileFromUrl(track.preview_url, "media/preview.mp3", msg, threadId);
                        } else {
                            utils.sendMessage({
                                "body": msg,
                                "url": track.external_urls.spotify // Should always exist
                            }, threadId);
                        }
                    } else {
                        console.log(err);
                    }
                });
            }
        });
    },
    "playlist": (threadId, cmatch, groupInfo) => {
        const playlists = groupInfo["playlists"];
        if (cmatch[1]) { // User provided
            if (cmatch[2]) { // Data provided
                const user = cmatch[1].toLowerCase();
                const userId = groupInfo.members[user];
                const name = groupInfo.names[userId];
                const newPlaylist = {
                    "name": name,
                    "id": userId,
                    "user": cmatch[3],
                    "uri": cmatch[4]
                };
                playlists[userId] = newPlaylist;
                setGroupProperty("playlists", playlists, groupInfo, (err) => {
                    if (!err) {
                        logInSpotify((err) => {
                            if (!err) {
                                spotify.getPlaylist(newPlaylist.user, newPlaylist.uri, {}, (err, data) => {
                                    if (!err) {
                                        let message = `Playlist "${data.body.name}" added to the group. Here are some sample tracks:\n`;
                                        const songs = data.body.tracks.items;
                                        for (let i = 0; i < config.spotifySearchLimit; i++) {
                                            if (songs[i]) {
                                                let track = songs[i].track;
                                                message += `– ${track.name}${track.explicit ? " (Explicit)" : ""} (from ${track.album.name})${(i != config.spotifySearchLimit - 1) ? "\n" : ""}`;
                                            }
                                        }
                                        utils.sendMessage(message, threadId);
                                    } else {
                                        sendError("Playlist couldn't be added; check the URI and make sure that you've set the playlist to public.", threadId);
                                    }
                                });
                            } else {
                                console.log(err);
                            }
                        });
                    }
                });
            } else {
                sendError("Please include a Spotify URI to add a playlist (see help for more info)", threadId);
            }
        } else { // No user provided; just display current playlists
            const pArr = Object.keys(playlists).map((p) => {
                return playlists[p];
            });
            if (pArr.length === 0) {
                utils.sendMessage(`No playlists for this group. To add one, use "${config.trigger} playlist" (see help).`, threadId);
            } else {
                logInSpotify((err) => {
                    if (!err) {
                        let results = [];
                        let now = current = (new Date()).getTime();

                        function updateResults(value) {
                            results.push(value);

                            const success = (results.length == pArr.length);
                            current = (new Date()).getTime();

                            if (success || (current - now) >= config.asyncTimeout) {
                                const descs = results.map((p) => {
                                    return `"${p.name}" by ${p.user} (${p.length} songs)`;
                                });
                                utils.sendMessage(`Playlists for this group:\n${descs.join("\n— ")}`, threadId);
                            }
                        }

                        for (let i = 0; i < pArr.length; i++) {
                            spotify.getPlaylist(pArr[i].user, pArr[i].uri, {}, (err, data) => {
                                if (!err) {
                                    updateResults({
                                        "name": data.body.name,
                                        "user": pArr[i].name,
                                        "length": data.body.tracks.items.length
                                    });
                                }
                            });
                        }
                    }
                });
            }
        }
    },
    "pin": (threadId, cmatch, groupInfo, _, fromUserId) => {
        const msg = cmatch[1];
        if (!msg) { // No new message; display current
            utils.sendMessage(groupInfo.pinned ? groupInfo.pinned : "No pinned messages in this chat.", threadId);
        } else { // Pin new message
            const pin = `"${msg}" – ${groupInfo.names[fromUserId]} on ${getDateString()}`;
            setGroupProperty("pinned", pin, groupInfo);
            utils.sendMessage(`Pinned new message to the chat: "${msg}"`, threadId);
        }
    },
    "tab": (threadId, cmatch, groupInfo) => {
        const op = cmatch[1];
        const amt = parseFloat(cmatch[2]) || 1;
        const cur = groupInfo.tab || 0;
        const numMembers = Object.keys(groupInfo.members).length;
        if (!op) { // No operation – just display total
            utils.sendMessage(`$${cur.toFixed(2)} ($${(cur / numMembers).toFixed(2)} per person in this group)`, threadId);
        } else if (op == "split") {
            const num = parseFloat(cmatch[2]) || numMembers;
            utils.sendMessage(`$${cur.toFixed(2)}: $${(cur / num).toFixed(2)} per person for ${num} ${(num == 1) ? "person" : "people"}`, threadId);
        } else if (op == "clear") { // Clear tab
            setGroupProperty("tab", 0, groupInfo, (err) => {
                if (!err) { utils.sendMessage("Tab cleared.", threadId); }
            });
        } else {
            const newTab = (op == "add") ? (cur + amt) : (cur - amt);
            setGroupProperty("tab", newTab, groupInfo, (err) => {
                if (!err) { utils.sendMessage(`Tab updated to $${newTab.toFixed(2)}.`, threadId); }
            });
        }
    },
    "addsearch": (threadId, cmatch, groupInfo, api) => {
        // Fields 1 & 3 are are for the command and the user, respectively
        // Field 2 is for an optional number parameter specifying the number of search results
        // for a search command (default is 1)
        const user = cmatch[3];
        const command = cmatch[1].split(" ")[0].toLowerCase(); // Strip opt parameter from match if present
        try {
            api.getUserID(user, (err, data) => {
                if (!err) {
                    const bestMatch = data[0]; // Hopefully the right person
                    const numResults = parseInt(cmatch[2]) || 1; // Number of results to display
                    if (command == "search") { // Is a search command
                        // Output search results / propic
                        for (let i = 0; i < numResults; i++) {
                            // Passes number of match to indicate level (closeness to top)
                            searchForUser(data[i], threadId, i);
                        }
                    } else { // Is an add command
                        // Add best match to group and update log of member IDs
                        addUser(bestMatch.userID, groupInfo);
                    }
                } else {
                    if (err.error) {
                        // Fix typo in API error message
                        sendError(`${err.error.replace("Bes", "Best")}`, threadId);
                    }
                }
            });
        } catch (e) {
            sendError(`User ${user} not recognized`);
        }
    },
    "order66": (threadId, _, groupInfo) => {
        // Remove everyone from the chat for configurable amount of time (see config.js)
        // Use stored threadId in case it changes later (very important)
        if (groupInfo.isGroup) {
            utils.sendMessage("I hate you all.", threadId);
            setTimeout(() => {
                let callbackset = false;
                for (let m in groupInfo.members) {
                    // Bot should never be in members list, but this is a safeguard
                    // (ALSO VERY IMPORTANT so that group isn't completely emptied)
                    if (groupInfo.members.hasOwnProperty(m) && groupInfo.members[m] != config.bot.id) {
                        if (!callbackset) { // Only want to send the message once
                            kick(groupInfo.members[m], groupInfo, config.order66Time, () => {
                                utils.sendMessage("Balance is restored to the Force.", threadId);
                            });
                            callbackset = true;
                        } else {
                            kick(groupInfo.members[m], groupInfo, config.order66Time);
                        }
                    }
                }
            }, 2000); // Make sure people see the message (and impending doom)
        } else {
            utils.sendMessage("Cannot execute Order 66 on a non-group chat. Safe for now, you are, Master Jedi.", threadId);
        }
    },
    "color": (threadId, cmatch, groupInfo, api) => {
        // Extract input and pull valid colors from API as well as current thread color
        const apiColors = api.threadColors;
        const hexToName = Object.keys(apiColors).reduce((obj, key) => { obj[apiColors[key]] = key; return obj; }, {}); // Flip the map
        const ogColor = hexToName[groupInfo.color ? groupInfo.color.toLowerCase() : groupInfo.color]; // Will be null if no custom color set

        if (cmatch[1]) {
            const inputColor = cmatch[2];
            const colorToSet = (inputColor.match(/rand(om)?/i)) ? getRandomColor() : inputColor.toLowerCase();

            // Construct a lowercased-key color dictionary to make input case insensitive
            const colors = {};
            for (let color in apiColors) {
                if (apiColors.hasOwnProperty(color)) {
                    colors[color.toLowerCase()] = apiColors[color];
                }
            }

            // Extract color values
            const hexVals = Object.keys(colors).map(n => colors[n]);
            const usableVal = hexVals.includes(colorToSet) ? colorToSet : colors[colorToSet];

            if (usableVal === undefined) { // Explicit equality check b/c it might be null (i.e. MessengerBlue)
                sendError("Couldn't find this color. See help for accepted values.", threadId);
            } else {
                api.changeThreadColor(usableVal, threadId, (err) => {
                    if (!err) {
                        utils.sendMessage(`Last color was ${ogColor}.`, threadId);
                    }
                });
            }
        } else { // No color requested – show current color
            utils.sendMessage(`The current chat color is ${ogColor} (hex value: ${groupInfo.color ? groupInfo.color : "empty"}).`, threadId);
        }
    },
    "hitlights": (threadId, _, groupInfo) => {
        const ogColor = groupInfo.color || config.defaultColor; // Will be null if no custom color set
        const delay = 500; // Delay between color changes (half second is a good default)
        for (let i = 0; i < config.numColors; i++) { // Need block scoping for timeout
            setTimeout(() => {
                api.changeThreadColor(getRandomColor(), threadId);
                if (i == (config.numColors - 1)) { // Set back to original color on last
                    setTimeout(() => {
                        api.changeThreadColor(ogColor, threadId);
                    }, delay);
                }
            }, delay + (i * delay)); // Queue color changes
        }
    },
    "clearnick": (threadId, cmatch, groupInfo, api) => {
        const user = cmatch[1].toLowerCase();
        api.changeNickname("", threadId, groupInfo.members[user]);
    },
    "setnick": (threadId, cmatch, groupInfo, api) => {
        const user = cmatch[1].toLowerCase();
        const newName = cmatch[2];
        api.changeNickname(newName, threadId, groupInfo.members[user]);
    },
    "wakeup": (threadId, cmatch, groupInfo) => {
        const user = cmatch[1].toLowerCase();
        const members = groupInfo.members; // Save in case it changes
        for (let i = 0; i < config.wakeUpTimes; i++) {
            setTimeout(() => {
                utils.sendMessage("Wake up", members[user]);
            }, 500 + (500 * i));
        }
        utils.sendMessage(`Messaged ${user.substring(0, 1).toUpperCase()}${user.substring(1)} ${config.wakeUpTimes} times`, threadId);
    },
    "randmess": (threadId, _, __, api) => {
        // Get thread length
        api.getThreadInfo(threadId, (err, data) => {
            if (!err) {
                const count = data.messageCount; // Probably isn't that accurate
                let randMessage = Math.floor(Math.random() * (count + 1));
                api.getThreadHistory(threadId, count, null, (err, data) => {
                    if (err) {
                        utils.sendMessage("Error: Messages could not be loaded", threadId);
                    } else {
                        let m = data[randMessage];
                        while (!(m && m.body)) {
                            randMessage = Math.floor(Math.random() * (count + 1));
                            m = data[randMessage];
                        }
                        let b = m.body,
                            name = m.senderName,
                            time = new Date(m.timestamp);
                        utils.sendMessage(`${b} - ${name} (${time.toLocaleDateString()})`, threadId);
                    }
                });
            }
        });
    },
    "alive": (_, __, groupInfo) => {
        sendGroupEmoji(groupInfo, "large"); // Send emoji and react to message in response
    },
    "emoji": (threadId, cmatch, groupInfo, api) => {
        api.changeThreadEmoji(cmatch[1], threadId, (err) => {
            if (err) {
                // Set to default as backup if errors
                api.changeThreadEmoji(groupInfo.emoji, threadId);
            }
        });
        updateGroupInfo(threadId); // Update emoji
    },
    "echo": (threadId, cmatch, _, api, fromUserId) => {
        const command = cmatch[1].toLowerCase();
        let message = `${cmatch[2]}`;
        if (command == "echo") {
            // Just an echo – repeat message
            utils.sendMessage(message, threadId);
        } else {
            // Quote - use name
            api.getUserInfo(fromUserId, (err, data) => {
                if (!err) {
                    // Date formatting
                    const now = new Date();
                    const date = now.getDate();
                    const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()];
                    const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][now.getMonth()];
                    const year = now.getFullYear();

                    message = `"${message}" – ${data[fromUserId].name}\n${day}, ${month} ${date}, ${year}`;
                    utils.sendMessage(message, threadId);
                }
            });
        }
    },
    "ban": (threadId, cmatch, groupInfo) => {
        const user = cmatch[2].toLowerCase();
        const userId = groupInfo.members[user];
        const callback = (err, users, status) => {
            if (err) {
                sendError(err, threadId);
            } else {
                config.banned = users;
                utils.sendMessage(`${groupInfo.names[userId]} successfully ${status}.`, threadId);
            }
        }
        if (user) {
            if (cmatch[1]) { // Unban
                cutils.removeBannedUser(userId, callback);
            } else { // Ban
                cutils.addBannedUser(userId, callback);
            }
        } else {
            sendError(`User ${user} not found`);
        }
    },
    "vote": (threadId, cmatch, groupInfo) => {
        const user = cmatch[2].toLowerCase();
        const userId = groupInfo.members[user];
        const user_cap = user.substring(0, 1).toUpperCase() + user.substring(1);
        const getCallback = (isAdd) => {
            return (err, success, newScore) => {
                if (success) {
                    utils.sendMessage(`${user_cap}'s current score is now ${newScore}.`, threadId);
                } else {
                    sendError("Score update failed.", threadId);
                }
            };
        };
        if (userId) {
            if (cmatch[1] == ">") {
                // Upvote
                updateScore(true, userId, getCallback(true));
            } else {
                // Downvote
                updateScore(false, userId, getCallback(false));
            }
        } else {
            sendError(`User ${user_cap} not found`, threadId);
        }
    },
    "score": (threadId, cmatch, groupInfo) => {
        if (cmatch[1]) { // Display scoreboard
            getAllScores(groupInfo, (success, scores) => {
                if (success) {
                    scores = scores.sort((a, b) => {
                        return (b.score - a.score); // Sort greatest to least
                    });

                    let message = `Rankings for ${groupInfo.name}:`;
                    for (let i = 0; i < scores.length; i++) {
                        message += `\n${i + 1}. ${scores[i].name}: ${scores[i].score}`;
                    }
                    utils.sendMessage(message, threadId);
                } else {
                    sendError("Scores couldn't be retrieved for this group.", threadId);
                }
            });
        } else if (cmatch[2]) {
            const user = cmatch[2].toLowerCase();
            const userId = groupInfo.members[user];
            const user_cap = user.substring(0, 1).toUpperCase() + user.substring(1);
            if (userId) {
                const new_score = cmatch[3];
                if (new_score || new_score == "0") { // Set to provided score if valid (0 is falsey)
                    setScore(userId, new_score, (err, success) => {
                        if (success) {
                            utils.sendMessage(`${user_cap}'s score updated to ${new_score}.`, threadId);
                        } else {
                            sendError(err, threadId);
                        }
                    });
                } else { // No value provided; just display score
                    getScore(`${userId}`, (err, val) => {
                        if (!err) {
                            const stored_score = val ? val.toString() : 0;
                            utils.sendMessage(`${user_cap}'s current score is ${stored_score}.`, threadId);
                        } else {
                            console.log(err);
                        }
                    });
                }
            } else {
                sendError(`User ${user_cap} not found`, threadId);
            }
        }
    },
    "restart": (threadId, ) => {
        restart(() => {
            utils.sendMessage("Restarting...", threadId);
        });
    },
    "photo": (threadId, cmatch, _, __, ___, attachments) => {
        // Set group photo to photo at provided URL
        const url = cmatch[1];
        if (url) {
            // Use passed URL
            setGroupImageFromUrl(url, threadId, "Can't set group image for this chat");
        } else if (attachments && attachments[0]) {
            if (attachments[0].type == "photo") {
                // Use photo attachment
                setGroupImageFromUrl(attachments[0].largePreviewUrl, threadId, "Attachment is invalid");
            } else {
                sendError("This command only accepts photo attachments", threadId);
            }
        } else {
            sendError("This command requires either a valid image URL or a photo attachment", threadId);
        }
    },
    "poll": (threadId, cmatch, _, api) => {
        const title = cmatch[1];
        const opts = cmatch[2];
        let optsObj = {};
        if (opts) {
            const items = opts.split(",");
            for (let i = 0; i < items.length; i++) {
                optsObj[items[i]] = false; // Initialize options to unselected in poll
            }
        }
        api.createPoll(title, threadId, optsObj, (err) => { // I contributed this func to the API!
            if (err) {
                sendError("Cannot create a poll in a non-group chat.", threadId);
            }
        });
    },
    "title": (threadId, cmatch, _, api) => {
        const title = cmatch[1];
        api.setTitle(title, threadId, (err) => {
            if (err) {
                sendError("Cannot set title for non-group chats.", threadId);
            }
        });
    },
    "answer": (threadId) => {
        utils.sendMessage(config.answerResponses[Math.floor(Math.random() * config.answerResponses.length)], threadId);
    },
    "space": (threadId, cmatch) => {
        const search = cmatch[2];
        request.get(`https://images-api.nasa.gov/search?q=${encodeURIComponent(search)}&media_type=image`, (err, res, body) => {
            if (!err) {
                const results = JSON.parse(body).collection.items;
                if (results && results.length > 0) {
                    const chosen = cmatch[1] ? Math.floor(Math.random() * results.length) : 0; // If rand not specified, use top result
                    const link = results[chosen].links[0].href;
                    const data = results[chosen].data[0];
                    sendFileFromUrl(link, `media/${data.nasa_id}.jpg`, `"${data.title}"\n${data.description}`, threadId);
                } else {
                    sendError(`No results found for ${search}`, threadId);
                }
            } else {
                sendError(`No results found for ${search}`, threadId);
            }
        });
    },
    "rng": (threadId, cmatch) => {
        let lowerBound, upperBound;
        if (cmatch[2]) {
            lowerBound = parseInt(cmatch[1]); // Assumed to exist if upperBound was passed
            upperBound = parseInt(cmatch[2]);
        } else { // No last parameter
            lowerBound = config.defaultRNGBounds[0];
            if (cmatch[1]) { // Only parameter passed becomes upper bound
                upperBound = parseInt(cmatch[1]);
            } else { // No params passed at all
                upperBound = config.defaultRNGBounds[1];
            }
        }
        const rand = Math.floor(Math.random() * (upperBound - lowerBound + 1)) + lowerBound;
        const chance = Math.abs(((1.0 / (upperBound - lowerBound + 1)) * 100).toFixed(2));
        utils.sendMessage(`${rand}\n\nWith bounds of (${lowerBound}, ${upperBound}), the chances of receiving this result were ${chance}%`, threadId);
    },
    "bw": (threadId, cmatch, groupInfo, _, __, attachments) => {
        const url = cmatch[1];
        processImage(url, attachments, groupInfo, (img, filename) => {
            img.greyscale().write(filename, (err) => {
                if (!err) {
                    sendFile(filename, threadId, "", () => {
                        fs.unlink(filename);
                    });
                }
            });
        });
    },
    "sepia": (threadId, cmatch, groupInfo, _, __, attachments) => {
        const url = cmatch[1];
        processImage(url, attachments, groupInfo, (img, filename) => {
            img.sepia().write(filename, (err) => {
                if (!err) {
                    sendFile(filename, threadId, "", () => {
                        fs.unlink(filename);
                    });
                }
            });
        });
    },
    "flip": (threadId, cmatch, groupInfo, _, __, attachments) => {
        const horiz = (cmatch[1].toLowerCase().indexOf("horiz") > -1); // Horizontal or vertical
        const url = cmatch[2];
        processImage(url, attachments, groupInfo, (img, filename) => {
            img.flip(horiz, !horiz).write(filename, (err) => {
                if (!err) {
                    sendFile(filename, threadId, "", () => {
                        fs.unlink(filename);
                    });
                }
            });
        });
    },
    "invert": (threadId, cmatch, groupInfo, _, __, attachments) => {
        const url = cmatch[1];
        processImage(url, attachments, groupInfo, (img, filename) => {
            img.invert().write(filename, (err) => {
                if (!err) {
                    sendFile(filename, threadId, "", () => {
                        fs.unlink(filename);
                    });
                }
            });
        });
    },
    "blur": (threadId, cmatch, groupInfo, _, __, attachments) => {
        const pixels = parseInt(cmatch[1]) || 2;
        const gauss = cmatch[2];
        const url = cmatch[3];
        processImage(url, attachments, groupInfo, (img, filename) => {
            if (gauss) {
                // Gaussian blur (extremely resource-intensive – will pretty much halt the bot while processing)
                utils.sendMessage("Hang on, this might take me a bit...", threadId, () => {
                    const now = (new Date()).getTime();
                    img.gaussian(pixels).write(filename, (err) => {
                        if (!err) {
                            sendFile(filename, threadId, `Processing took ${((new Date()).getTime() - now) / 1000} seconds.`, () => {
                                fs.unlink(filename);
                            });
                        }
                    });
                });
            } else {
                img.blur(pixels).write(filename, (err) => {
                    if (!err) {
                        sendFile(filename, threadId, "", () => {
                            fs.unlink(filename);
                        });
                    }
                });
            }
        });
    },
    "overlay": (threadId, cmatch, groupInfo, _, __, attachments) => {
        const url = cmatch[1];
        const overlay = cmatch[2];
        processImage(url, attachments, groupInfo, (img, filename) => {
            jimp.loadFont(jimp.FONT_SANS_32_BLACK, (err, font) => {
                if (!err) {
                    const width = img.bitmap.width; // Image width
                    const height = img.bitmap.height; // Image height
                    const textDims = measureText(font, overlay); // Get text dimensions (x,y)
                    img.print(font, (width - textDims[0]) / 2, (height - textDims[1]) / 2, overlay, (width + textDims[0])).write(filename, (err) => {
                        if (!err) {
                            sendFile(filename, threadId, "", () => {
                                fs.unlink(filename);
                            });
                        }
                    });
                } else {
                    sendError("Couldn't load font", threadId);
                }
            });
        });
    },
    "brightness": (threadId, cmatch, groupInfo, _, __, attachments) => {
        const bright = (cmatch[1].toLowerCase() == "brighten");
        // Value must range from -1 to 1
        let perc = parseInt(cmatch[2]);
        perc = (perc > 100) ? 1 : (perc / 100.0);
        perc = bright ? perc : (-1 * perc);
        const url = cmatch[3];
        processImage(url, attachments, groupInfo, (img, filename) => {
            img.brightness(perc).write(filename, (err) => {
                if (!err) {
                    sendFile(filename, threadId, "", () => {
                        fs.unlink(filename);
                    });
                }
            });
        });
    },
    "mute": (threadId, cmatch, groupInfo) => {
        const getCallback = (muted) => {
            return (err) => {
                if (!err) {
                    utils.sendMessage(`Bot ${muted ? "muted" : "unmuted"}`, threadId);
                }
            }
        }
        const mute = !(cmatch[1]); // True if muting; false if unmuting
        setGroupProperty("muted", mute, groupInfo, getCallback(mute));
    },
    "christen": (threadId, cmatch, _, api) => {
        api.changeNickname(cmatch[1], threadId, config.bot.id);
    },
    "wolfram": (threadId, cmatch) => {
        const query = cmatch[1];
        request(`http://api.wolframalpha.com/v1/result?appid=${credentials.WOLFRAM_KEY}&i=${encodeURIComponent(query)}`, (err, res, body) => {
            if (!(err || body == "Wolfram|Alpha did not understand your input")) {
                utils.sendMessage(body, threadId);
            } else {
                utils.sendMessage(`No results found for "${query}"`, threadId);
            }
        });
    },
    "destroy": (threadId, _, groupInfo, api) => { // DANGEROUS COMMAND
        for (let m in groupInfo.members) {
            // Bot should never be in members list, but this is a safeguard
            // (ALSO VERY IMPORTANT so that group isn't completely emptied)
            // We're talking triple redundancies at this point
            if (groupInfo.members.hasOwnProperty(m) && groupInfo.members[m] != config.bot.id
                && groupInfo.members[m] != api.getCurrentUserID()) {
                kick(groupInfo.members[m], groupInfo);
            }
        }
        // Archive the thread afterwards to avoid clutter in the messages list
        // (bot will still have access and be able to add people back if necessary)
        api.changeArchivedStatus(threadId, true, (err) => {
            if (err) {
                console.log(`Error archiving thread ${threadId}`);
            }
        });
    },
    "clearstats": () => {
        resetStats();
    },
    "infiltrate": (threadId, cmatch, _, api) => {
        const searchName = cmatch[1];
        api.getThreadList(0, config.threadLimit, "inbox", (err, chats) => {
            if (!err) {
                if (!searchName) { // Just list chats
                    let message = "Available groups:";
                    message += chats.filter((c) => {
                        // Check if can add admin
                        const members = c.participantIDs;
                        const botLoc = members.indexOf(config.bot.id);
                        if (botLoc > -1) {
                            members.splice(botLoc, 1);
                            // Can add to chat and more than the bot & one other in the chat
                            return (c.canReply && members.length > 1);
                        }
                        return false;
                    }).map((c) => {
                        const numMembers = c.participants.length - 1; // Exclude bot
                        return `\n– ${c.name || c.threadID} (${numMembers} ${numMembers == 1 ? "member" : "members"})`;
                    }).join("");
                    utils.sendMessage(message, threadId);
                } else {
                    let chatFound = false;
                    for (let i = 0; i < chats.length; i++) {
                        const chatName = chats[i].name;
                        const chatId = chats[i].threadID;
                        if (chatId == searchName || chatName.toLowerCase().indexOf(searchName.toLowerCase()) > -1) {
                            chatFound = true;
                            addUser(config.owner.id, {
                                "threadId": chatId
                            }, true, (err) => {
                                if (err) {
                                    sendError(`You're already in group "${chatName}".`, threadId);
                                } else {
                                    utils.sendMessage(`Added you to group "${chatName}".`, threadId);
                                }
                            }, false); // Add admin to specified group; send confirmation to both chats
                        }
                    }
                    if (!chatFound) {
                        sendError(`Chat with name "${searchName}" not found.`, threadId)
                    }
                }
            } else {
                sendError("Thread list couldn't be retrieved.", threadId);
            }
        });
    },
    "alias": (threadId, cmatch, groupInfo) => {
        const user = cmatch[2].toLowerCase();
        const aliasInput = cmatch[3]
        const aliases = groupInfo.aliases;
        const name = groupInfo.names[groupInfo.members[user]];
        if (cmatch[1]) { // Clear
            delete aliases[user];
            setGroupProperty("aliases", aliases, groupInfo, (err) => {
                if (!err) {
                    utils.sendMessage(`Alias cleared for ${name}.`, threadId);
                }
            });
        } else if (aliasInput) { // Set new alias
            const alias = aliasInput.toLowerCase();
            aliases[user] = alias;
            setGroupProperty("aliases", aliases, groupInfo, (err) => {
                if (!err) {
                    utils.sendMessage(`${name} can now be called "${aliasInput}".`, threadId);
                }
            });
        } else { // Display alias for user if exists
            if (aliases[user]) {
                utils.sendMessage(`${name} can also be called "${aliases[user]}".`, threadId);
            } else {
                utils.sendMessage(`${name} does not have an alias.`, threadId);
            }
        }
    },
    "weather": (threadId, cmatch) => {
        const city = cmatch[1];
        request(`http://api.openweathermap.org/data/2.5/weather?appid=${credentials.WEATHER_KEY}&q=${city}&units=imperial`, (err, res, body) => {
            if (!err && res.statusCode == 200) {
                const data = JSON.parse(body);
                const name = data.name;
                const country = data.sys.country;
                const weather = data.weather[0];
                const cur = data.main;

                const msg = `Weather for ${name} (${country}):\nConditions: ${weather.description}\nTemp: ${cur.temp} ºF (L-${cur.temp_min} H-${cur.temp_max})\nCloud cover: ${data.clouds.all}%`;
                sendFileFromUrl(`http://openweathermap.org/img/w/${weather.icon}.png`, `media/${weather.icon}.png`, msg, threadId);
            } else {
                sendError("Couldn't retrieve weather for that location.", threadId);
            }
        });
    },
    "branch": (threadId, cmatch, groupInfo, _, fromUserId) => {
        const input = cmatch[1];
        const members = input.split(",").map(m => parseNameReplacements(m.toLowerCase().trim(), fromUserId, groupInfo));
        const ids = members.map(m => groupInfo.members[m]);

        // Start a new chat with the collected IDs and the bot
        utils.sendMessage(`Welcome! This group was created from ${groupInfo.name}.`, ids, (err, info) => {
            if (!err) {
                utils.sendMessage("Subgroup created.", threadId);
            } else {
                console.log(err);
            }
        });
    },
    "restore": (threadId, cmatch, _, api) => {
        const oldId = cmatch[1];

        // Collect properties about old chat
        getGroupInfo(oldId, (err, info) => {
            // Also collect info about current chat to check against
            getGroupInfo(threadId, (curErr, curInfo) => {
                if (err || !info) {
                    sendError("Couldn't find any stored information for that chat; make sure the bot has been initialized in it previously.", threadId);
                } else if (curErr || !curInfo) {
                    sendError("Couldn't load information about this current chat; wait for initialization.", threadId);
                } else {
                    const restorables = {
                        "title": (info.name == exports.defaultTitle) ? null : info.name,
                        "emoji": info.emoji,
                        "color": info.color,
                        "nicknames": info.nicknames,
                        "muted": info.muted,
                        "playlists": info.playlists,
                        "aliases": info.aliases,
                        "tab": info.tab,
                        "pinned": info.pinned
                    }

                    // Check for restorable properties and restore them
                    if (restorables.title && curInfo.isGroup) { api.setTitle(restorables.title, threadId); }
                    if (restorables.emoji) { api.changeThreadEmoji(restorables.emoji, threadId); }
                    if (restorables.color) { api.changeThreadColor(restorables.color, threadId); }
                    if (restorables.nicknames) {
                        for (let id in restorables.nicknames) {
                            // Check if member is in the current group first
                            if (restorables.nicknames.hasOwnProperty(id) && cutils.contains(id, curInfo.members)) {
                                api.changeNickname(restorables.nicknames[id], threadId, id);
                            }
                        }
                    }
                    // Restore groupInfo properties (cascaded to avoid race conditions)
                    setGroupProperty("muted", restorables.muted, curInfo, () => {
                        setGroupProperty("playlists", restorables.playlists, curInfo, () => {
                            setGroupProperty("aliases", restorables.aliases, curInfo, () => {
                                setGroupProperty("tab", restorables.tab, curInfo, () => {
                                    setGroupProperty("pinned", restorables.pinned, curInfo);
                                });
                            });
                        });
                    });
                }
            });
        });
    },
    "google": (threadId, cmatch) => {
        const query = cmatch[1];
        const encoded = encodeURI(query);
        utils.sendMessage({
            "url": `https://www.google.com/search?q=${encoded}`
        }, threadId);
    },
    "snap": (threadId, _, groupInfo, api, fromUserId) => {
        // Remove a random half of the members from the chat for configurable amount of time (see config.js)
        // Use stored threadId in case it changes later (very important)
        if (groupInfo.isGroup) {
            api.getUserInfo(fromUserId, (err, info) => {
                if (!err) {
                    const sender = info[fromUserId].name.split(" ");
                    utils.sendMessage(`You have my respect, ${sender[sender.length - 1]}. I hope they remember you.`, threadId);
                    setTimeout(() => {
                        let callbackset = false;

                        const mem = Object.keys(groupInfo.members);
                        const len = mem.length;
                        let selected = [];
                        for (let i = 0; i < len / 2; i++) {
                            let s = mem[Math.floor(Math.random() * len)];
                            while (selected.indexOf(s) > -1) {
                                s = mem[Math.floor(Math.random() * len)];
                            }
                            selected[i] = s;
                        }
                        const snapped = selected.map(key => groupInfo.members[key]);

                        for (let i = 0; i < snapped.length; i++) {
                            // Bot should never be in members list, but this is a safeguard
                            // (ALSO VERY IMPORTANT so that group isn't completely emptied)
                            if (snapped[i] != config.bot.id) {
                                if (!callbackset) { // Only want to send the message once
                                    kick(snapped[i], groupInfo, config.order66Time, () => {
                                        utils.sendMessage("Perfectly balanced, as all things should be.", threadId);
                                    });
                                    callbackset = true;
                                } else {
                                    kick(snapped[i], groupInfo, config.order66Time);
                                }
                            }
                        }
                    }, 2000); // Make sure people see the message (and impending doom)
                }
            });
        } else {
            utils.sendMessage("Cannot perform The Snap on a non-group chat. The hardest choices require the strongest wills.", threadId);
        }
    },
    "choose": (threadId, cmatch) => {
        const choices = cmatch[1].split(",");
        const choice = choices[Math.floor(Math.random() * choices.length)];

        utils.sendMessage(choice, threadId);
    },
    "course": (threadId, cmatch) => {
        const course = cmatch[1];
        request.get(`https://api.umd.io/v0/courses/${course}`, (err, res, body) => {
            if (!err) {
                const data = JSON.parse(body);
                if (data.error_code && data.error_code == 404) {
                    sendError("Course not found", threadId);
                } else {
                    const msg = `${data.name} (${data.course_id})\nCredits: ${data.credits}\n\n${data.description}`;
                    utils.sendMessage(msg, threadId);
                }
            }
        });
    },
    "professor": (threadId, cmatch) => {
        const prof = cmatch[1];
        request.get(`https://api.umd.io/v0/professors?name=${encodeURIComponent(prof)}`, (err, res, body) => {
            if (!err) {
                const data = JSON.parse(body);
                if (data.error_code && data.error_code == 404 || data.length < 1) {
                    sendError("Professor not found", threadId);
                } else {
                    const best = data[0];
                    const msg = `${best.name} (${best.departments.join(", ")})\n\nCourses:\n${best.courses.join("\n")}`;
                    utils.sendMessage(msg, threadId);
                }
            }
        });
    },
    "remind": (threadId, cmatch, groupInfo, _, fromUserId) => {
        const time = parseInt(cmatch[1]);
        const timeMS = time * 60000;
        const msg = cmatch[2];
        const user = groupInfo.names[fromUserId];
        const tag = `@${user}`

        utils.sendMessage(`I'll remind you in ${time == 1 ? "1 minute" : `${time} minutes`}.`, threadId);

        setTimeout(() => {
            const mentions = [{ "tag": tag, "id": fromUserId }];
            utils.sendMessageWithMentions(`Reminder for ${tag}: ${msg}`, mentions, threadId);
        }, timeMS)
    },
    "whereis": (threadId, cmatch) => {
        const query = cmatch[1];
        let url = "https://www.google.com/maps/search/?api=1&query=";
        request.get("https://api.umd.io/v0/map/buildings", (err, res, body) => {
            if (!err) {
                const buildings = JSON.parse(body);
                let match;
                let i = 0;
                while (!match && i < buildings.length) {
                    const build = buildings[i];
                    const name = build.name;
                    const code = build.code;
                    const matcher = new RegExp(query, "i");
                    if (name.match(matcher) || code.match(matcher)) {
                        match = build;
                    }
                    i++;
                }

                if (match) {
                    utils.sendMessage({
                        "url": `${url}${match.lat},${match.lng}`
                    }, threadId);
                } else {
                    sendError("No building matches found.", threadId);
                }
            }
        });
    }
};

/*
    Run function: called with threadId, the matchInfo object (previously "co"),
    the groupInfo object, the current api instance, fromUserId, and any
    attachments.

    Matches the correct command and runs its associated function block (above),
    passing in the requisite information from main.
*/
exports.run = (api, matchInfo, groupInfo, fromUserId, attachments) => {
    for (c in matchInfo) {
        if (matchInfo.hasOwnProperty(c) && matchInfo[c].m) {
            // Match found
            funcs[c](groupInfo.threadId, matchInfo[c].m, groupInfo, api,
                fromUserId, attachments);
        }
    }
}