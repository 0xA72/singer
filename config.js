//
//  config.js
//
//  Created by Yuriy Gaytrov on 27.10.2025.
//  Copyright (c) 2025 A72. All rights reserved.
//

//****************************************************************

module.exports = { 
    
	// порт proxy сервера
	localPort: 7777,

	// список адресов, для которых требуется
	// обработка TLS ClientHello
	exploreList: [
		'google.com',
		'googleapis.com',
		'googlevideo.com',
		'gstatic.com',
		'youtube.com',
		'youtu.be',
		'yt.be',
		'ytimg.com',
		'ggpht.com'
	],

	// список DNS серверов, которые будут использованы
	// для получения IP адресов
	dnsList: [
		'1.1.1.1',
		'8.8.8.8'
	]
}

//****************************************************************
//
//
//
//****************************************************************