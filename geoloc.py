import os, urllib2, zipfile, bisect

def ip_to_32(ip):
    ip = map(int, ip.split('.'))
    return (ip[0] << 24) + (ip[1] << 16) + (ip[2] << 8) + ip[3]
            
locations, ips = {}, []

def load_ip_locations():
    # locations: (geoname_id, continent_code, continent_name, country_iso_code, country_name,
    #            subdivision_iso_code, subdivision_name, city_name, metro_code, time_zone)
    # ips:       (network_start_ip, network_mask_length, geoname_id, registered_country_geoname_id,
    #            represented_country_geoname_id, postal_code, lat, lng,is_anonymous_proxy,
    #            is_satellite_provider)
    global ips, locations
    ips = []
    filename = 'GeoLite2-City-CSV.zip'
    if not os.path.exists(filename):
        print '=== DOWNLOADING', filename, '==='
        data = urllib2.urlopen('http://geolite.maxmind.com/download/geoip/database/%s' % filename).read()
        with open(filename, 'w') as f:
            f.write(data)
    print '=== LOADING', filename, '==='
    with zipfile.ZipFile(filename, 'r') as zf:
        f = zf.open('GeoLite2-City-CSV_20140805/GeoLite2-City-Locations.csv', 'r').read().split('\n')
        for line in f[1:-1]:
            line = line.split(',')
            locations[line[0]] = tuple(map(intern,line))
        print len(locations), "locations"
        f = zf.open('GeoLite2-City-CSV_20140805/GeoLite2-City-Blocks.csv', 'r').read().split('\n')
        for line in f[1:-1]:
            (network_start_ip, network_mask_length, geoname_id, registered_country_geoname_id,
                represented_country_geoname_id, postal_code, lat, lng,is_anonymous_proxy,
                is_satellite_provider) = line.split(',')
            if network_start_ip.startswith("::ffff:"): # ip4
                network_mask_length =  (1 << (128 - int(network_mask_length)))
                network_start_ip = ip_to_32(network_start_ip[7:].split(',')[0])
                ips.append((network_start_ip, network_mask_length, locations.get(geoname_id),
                    locations.get(registered_country_geoname_id), locations.get(represented_country_geoname_id),
                    intern(postal_code), float(lat) if lat else None, float(lng) if lng else None,
                    bool(is_anonymous_proxy), bool(is_satellite_provider)))
        ips.sort()
        print len(ips), "ips"

def resolve_ip(ip):
    if ips:
        try:
            ip = ip_to_32(ip)
        except (ValueError, IndexError): # ip6?
            return
        i = bisect.bisect_right(ips, (ip, ))
        if ips[i][0] > ip:
            i -= 1
        if ips[i][0] <= ip and ips[i][0] + ips[i][1] > ip:
            return ips[i]

