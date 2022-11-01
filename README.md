# nodedsa
Sample
----
```
var conn = require('nodedsa').open(url, accesstoken);
// accesstoken can be securityToken object ex: {"@": ["Type"],"Type": "Passport","DSAPassport": {...}}
conn.send({
	service:'',
	body:{},
	result:function(resp){
	
	}
});

var resp = await conn.send({
	service:'',
	body:{}
});
```

License
----

MIT

Version
----
1.0

