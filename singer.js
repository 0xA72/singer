//
//  singer.js
//
//  Created by Yuriy Gaytrov on 27.10.2025.
//  Copyright (c) 2025 A72. All rights reserved.
//

//****************************************************************
//
//
//
//****************************************************************

const dns = require('node:dns');
const net = require('node:net');
const crypto = require('node:crypto');

//****************************************************************

const config = require('./config');

//****************************************************************
//
//
//
//****************************************************************

// объявляем режимы работы proxy сервера
const HandleHttpConnect = 1;  // обработка HTTP запроса на соединение 
const HandleClientHello = 2;  // обработка TLS ClienHello от клиента
const ProxyRawData      = 3;  // передача данных без обработки 

//****************************************************************
//
//
//
//****************************************************************

function clientHelloHandler(client, server)
{
    // объединяем полученные данные
    const hello = Buffer.concat(client.chunks);
    // и если можно прочитать заголовок
    if( hello.length > 5 )
    {
        // и если требуемые данные получены полностью
        if( hello.readUInt16BE(3) + 5 == hello.length )
        {
            // инициализируем список фрагментов
            var fragmentList = [];

            // выделяем заголовок фрагментов
            const headerFragment = hello.subarray(0, 3);

            // выделяем значащие данные для преобразования и передачи
            var payload = hello.subarray(5);
            // и делим их на части
            while( payload.length > 0 )
            {
                // определяем размер фрагмента 
                var fragmentLength = crypto.randomInt(2, 100);
                if( payload.length < fragmentLength ) fragmentLength = payload.length;

                // выделяем его из данных
                var payloadFragment = payload.subarray(0, fragmentLength);

                // формируем запись размера фрагмента
                var lengthFragment = Buffer.alloc(2);
                lengthFragment.writeUInt16BE(fragmentLength, 0);

                // и все это добавляем в список для передачи
                fragmentList.push(headerFragment);
                fragmentList.push(lengthFragment);
                fragmentList.push(payloadFragment);

                // удаляем данные фрагмента, так как мы их уже обработали
                payload = payload.subarray(fragmentLength);
            }

            // и после обработки отправляем все фрагменты на внешний сервер
            if( !server.write( Buffer.concat(fragmentList) ) ) client.pause();

            // очищаем массив блоков переданных данных
            client.chunks = [];
            // и переходим в режим обмена данными
            client.handleMode = ProxyRawData;
        }
    }
}

//****************************************************************
//
//
//
//****************************************************************

function exploreAddress(remoteAddress)
{
    // проходимся по списку адресов, для которых требуется обработка TLS ClientHello
    for( var address of config.exploreList )
    {
        // и возвращаем признак необходимости
        // если адрес внешнего сервера есть в списке
        if( remoteAddress.includes(address) ) return true;
    }

    // иначе обработка не требуется
    return false;
}

//****************************************************************
//
//
//
//****************************************************************

function httpConnectHandler(client, server)
{
    // объединяем и конвертируем полученные данные в строку
    const request = Buffer.concat(client.chunks).toString('ascii');
    // если запрос на соединение получен полностью
    if( request.indexOf('\r\n\r\n') > 0 )
    {
        // получаем список строк запроса
        const list = request.split('\r\n');
        // получаем основные параметры запроса для метода CONNECT
        const [httpMethod, remoteHost, httpVersion] = list[ 0 ].split(' ');
        // получаем адрес и порт внешнего сервера
        const [remoteAddress, remotePort] = remoteHost.split(':');

        // и если это ожидаемый нами метод
        if( httpMethod === 'CONNECT' )
        {
            // отправляем клиенту сообщение о необходимости подождать
            client.write(httpVersion + ' 102 Processing\r\n\r\n');

            // получаем список IP адресов сервера назначения
            dns.resolve4(remoteAddress, (error, addresses) => {
                // если при их получении возникла ошибка
                if( error )
                {
                    // вывод вывод отладочной информации
                    console.log('? ' + remoteAddress);
                    // и отправляем клиенту сообщение о том, что сервер назначения не найден
                    client.write(httpVersion + '502 Bad Gateway\r\n\r\n');
                }

                // иначе список IP адресов получен
                else
                {
                    // соединяемся с внешним сервером по первому IP адресу из списка
                    server.connect(parseInt(remotePort), addresses[ 0 ]);
                    // и отправляем клиенту сообщение об успешном соединении с требуемым сервером
                    client.write(httpVersion + ' 200 Connection Established\r\n\r\n');

                    // если порт внешнего сервера требует TLS соединения
                    if( remotePort === '443' )
                    {
                        // переходим в соответсвующий режим если требуется обработка TLS ClientHello
                        if( exploreAddress(remoteAddress) ) client.handleMode = HandleClientHello;
                        // иначе переходим в режим обмена данными
                        else client.handleMode = ProxyRawData;
                    }

                    // во всех остальных случаях переходим в режим обмена данными
                    else client.handleMode = ProxyRawData;

                    // очищаем массив блоков ранее полученных данных
                    client.chunks = [];

                    // вывод отладочной информации
                    if( client.handleMode === HandleClientHello ) console.log('+ ' + remoteAddress);
                    else console.log('- ' + remoteAddress);
                }
            });
        }

        // но завершаем обмен данными если это неожидаемый метод
        else client.destroy();
    }
}

//****************************************************************
//
//
//
//****************************************************************

function proxyHandler(client)
{
    // инициализируем массив для блоков переданных данных
    client.chunks = [];
    // начинаем обработку с HTTP запроса на соединение
    client.handleMode = HandleHttpConnect;

    // и создаем сокет для соединения с сервером
    var server = new net.Socket();

    // если клиент передал данные
    client.on('data', (data) => {
        
        // выполняем операции согласно требуемого режима обработки
        switch( client.handleMode )
        {
            // обрабатываем HTTP метод CONNECT для определения внешнего сервера
            // и необходимости дальнейшей обработки TLS ClientHello
            case HandleHttpConnect:
                // добавляем полученные данные в промежуточный буфер
                client.chunks.push(data);
                // и обрабатываем их
                httpConnectHandler(client, server);
                break;
  
            // если требуется обработка TLS ClientHello
            case HandleClientHello:
                // добавляем полученные данные в промежуточный буфер
                client.chunks.push(data);
                // и обрабатываем их
                clientHelloHandler(client, server);
                break;

            // режим передачи данных без анализа и обработки
            case ProxyRawData:
                // просто все данные отправляем серверу
                // и останавливаем получение пока все данные не будут переданы
                if( !server.write(data) ) client.pause();
                break;
        }
    });

    // если сервер передал данные
    server.on('data', (data) => {
        // отправляем их клиенту и останавливаем получение
        // пока все данные не будут переданы
        if( !client.write(data) ) server.pause();
    });

    // если все данные были отправлены клиенту
    client.on('drain', () => {
        // продолжаем обмен данными с сервером
        server.resume();
    });

    // если все данные были отправлены серверу
    server.on('drain', () => {
        // продолжаем обмен данными с клиентом
        client.resume();
    });

    // если клиент закрыл соединение
    client.on('close', (error) => {
        // закрываем и соединение с сервером
        server.destroy();
    });

    // если сервер закрыл соединение
    server.on('close', (error) => {
        // закрываем и соединение с клиентом
        client.destroy();
    });

    // если вышло время ожидания
    client.on('timeout', () => {
        // закрываем соединение
        client.destroy();
    });

    // если вышло время ожидания
    server.on('timeout', () => {
        // закрываем соединение
        server.destroy();
    });

    // если произошла ошибка на клиенте
    client.on('error', (error) => {
        // закрываем соединение
        client.destroy();
    });

    // если произошла ошибка на сервере
    server.on('error', (error) => {
        // закрываем соединение
        server.destroy();
    });
}

//****************************************************************
//
//
//
//****************************************************************

// задаем список DNS серверов
// для получения IP адресов запрашиваемых хостов
dns.setServers(config.dnsList);

// создаем proxy сервер
var proxy = net.createServer();
// регистрируем обработчик соединений
proxy.on('connection', proxyHandler);
// и запускаем его
proxy.listen(config.localPort);

//****************************************************************
//
//
//
//****************************************************************
