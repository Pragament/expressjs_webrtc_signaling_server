const crypto = require('crypto');

function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const publicKey = ecdh.getPublicKey('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const privateKey = ecdh.getPrivateKey('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  console.log('Public Key:', publicKey);
  console.log('Private Key:', privateKey);
}

generateVapidKeys();
