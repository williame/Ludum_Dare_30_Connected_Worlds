import os, urllib2, zipfile, sqlite3, traceback, json

from external import pysmaz

def ip_to_32(ip):
    ip = map(int, ip.split('.'))
    return (ip[0] << 24) + (ip[1] << 16) + (ip[2] << 8) + ip[3]

db = None

def load_ip_locations():
    # locations: (geoname_id, continent_code, continent_name, country_iso_code, country_name,
    #            subdivision_iso_code, subdivision_name, city_name, metro_code, time_zone)
    # ips:       (network_start_ip, network_mask_length, geoname_id, registered_country_geoname_id,
    #            represented_country_geoname_id, postal_code, lat, lng,is_anonymous_proxy,
    #            is_satellite_provider)
    global db
    if os.path.exists("geo.db"):
        print '=== LOADING GEO DB ==='
        db = sqlite3.connect('geo.db')
        db.text_factory = str
        return
    # make the DB then
    print '=== MAKING GEO DB ==='
    locations, ips = {}, []
    zipfilename = 'GeoLite2-City-CSV.zip'
    folder = 'GeoLite2-City-CSV_20140805'
    if not os.path.exists(folder):
        if not os.path.exists(zipfilename):
            print '=== DOWNLOADING', zipfilename, '==='
            data = urllib2.urlopen('http://geolite.maxmind.com/download/geoip/database/%s' % zipfilename).read()
            with open(filename, 'w') as f:
                f.write(data)
    def load_location(line):
        if line:
            line = line.split(',')
            locations[intern(line[0])] = tuple(map(intern,line))
    def load_ip(line):
        if line:
            (network_start_ip, network_mask_length, geoname_id, registered_country_geoname_id,
                represented_country_geoname_id, postal_code, lat, lng,is_anonymous_proxy,
                is_satellite_provider) = line.split(',')
            if network_start_ip.startswith("::ffff:"): # ip4
                network_mask_length =  (1 << (128 - int(network_mask_length)))
                network_start_ip = ip_to_32(network_start_ip[7:].split(',')[0])
                ips.append((network_start_ip, network_mask_length, geoname_id,
                    registered_country_geoname_id, represented_country_geoname_id,
                    intern(postal_code), float(lat) if lat else None, float(lng) if lng else None,
                    bool(is_anonymous_proxy), bool(is_satellite_provider)))
    if os.path.exists(folder):
        print '=== LOADING', folder, '==='
        first = True
        for line in open('%s/GeoLite2-City-Locations.csv' % folder, 'r'):
            if first: first = False
            else: load_location(line)
        first = True
        for line in open('%s/GeoLite2-City-Blocks.csv' % folder, 'r'):
            if first: first = False
            else: load_ip(line)
    else:
        with zipfile.ZipFile(zipfilename, 'r') as zf:
            print '=== LOADING', zipfilename, '==='
            first = True
            for line in zf.open('%s/GeoLite2-City-Locations.csv' % folder, 'r'):
                if first: first = False
                else: load_location(line)
            
            first = True
            for line in zf.open('%s/GeoLite2-City-Blocks.csv' % folder, 'r'):
                if first: first = False
                else: load_ip(line)
    print len(locations), "locations"
    print len(ips), "ips"
    db = sqlite3.connect('geo.db')
    db.text_factory = str
    cursor = db.cursor()
    cursor.execute('CREATE TABLE locs(id TEXT PRIMARY KEY, data TEXT)')
    cursor.execute('CREATE TABLE ips(ip INTEGER PRIMARY KEY, data TEXT)')
    db.commit()
    for i, ip in enumerate(ips):
        try:
            cursor.execute('INSERT INTO ips(ip, data) VALUES(?,?)', (ip[0], pysmaz.compress(json.dumps(ip))))
        except sqlite3.IntegrityError as e:
            print "WARNING:", i, ip, e
    db.commit()
    for loc in locations.values():
        cursor.execute('INSERT INTO locs(id, data) VALUES(?,?)', (loc[0], pysmaz.compress(json.dumps(loc))))
    db.commit()
    cursor.close()

def resolve_ip(ip):
    if db:
        try:
            ip = ip_to_32(ip)
        except (ValueError, IndexError): # ip6?
            return
        try:
            cursor = db.cursor()
            candidate, row = cursor.execute('SELECT ip, data FROM ips WHERE ip <= ? ORDER BY ip DESC LIMIT 1', (ip,)).fetchone()
            row = json.loads(pysmaz.decompress(row))
            if candidate <= ip and candidate + row[1] > ip:
                location = cursor.execute('SELECT data FROM locs WHERE id = ?', (row[2],)).fetchone()
                if location:
                    location = pysmaz.decompress(location[0])
                    row[2] = json.loads(location)
                return row
        except (TypeError, ValueError) as e:
            print "ERROR resolving", ip, "->", e 
            
def pretty_ip(ip):
    info = resolve_ip(ip)
    if info and info[2]:
        return "%s (%s, %s)" % (ip, info[2][4], info[2][7])
    return ip

if __name__ == "__main__":
    load_ip_locations()
